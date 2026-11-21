// The API server. Caddy routes /api here; everything else is static files.

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createAuth, type Auth } from './auth.ts'
import { createDb, type Db } from './db.ts'
import { LayersRepo } from './layers.ts'
import { createMailer } from './mail.ts'
import { migrateToLatest } from './migrate.ts'
import { requestRoutes } from './requests.ts'

export function createApp(auth: Auth, db: Db, repo: LayersRepo, siteUrl: string) {
    const app = new Hono().basePath('/api')
    const requests = requestRoutes(db, auth, repo, siteUrl)
    app.get('/', c => c.json({ hello: 'Elgeis' }))
    app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))
    app.route('/', requests.app)
    // Errors are JSON, like Better Auth's, with a message to show.
    app.onError((e, c) => {
        if (e instanceof HTTPException) return c.json({ message: e.message }, e.status)
        console.error(e)
        return c.json({ message: 'Something went wrong on our end' }, 500)
    })
    return { app, reconcile: requests.reconcile }
}

if (import.meta.main) {
    const env = process.env
    const db = createDb(env.DATABASE_URL!)
    await migrateToLatest(db)

    const repo = new LayersRepo(env.LAYERS_REPO!, env.LAYERS_BUILD!, env.LAYERS_REMOTE!)
    // Every layer in the repo gets a row, for its admins and change requests.
    if (repo.data.length) await db.insertInto('layer').values(repo.data.map(l => ({ id: l.layer.id }))).onConflict(c => c.doNothing()).execute()

    const auth = createAuth(db, {
        siteUrl: env.SITE_URL!,
        secret: env.BETTER_AUTH_SECRET!,
        sendMail: createMailer(env.SMTP_URL!, env.MAIL_FROM!),
    })
    const { app, reconcile } = createApp(auth, db, repo, env.SITE_URL!)
    await reconcile()
    // Pick up edits made to the layers remote directly.
    setInterval(() => reconcile().catch(e => console.error('Catching up with the layers repo failed:', e)), 5 * 60 * 1000)
    const port = Number(env.PORT ?? 3000)
    serve({ fetch: app.fetch, port }, () => console.log(`Listening on port ${port}`))
}
