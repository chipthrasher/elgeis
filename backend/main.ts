// The API server. Caddy routes /api here; everything else is static files.

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createAuth, type Auth } from './auth.ts'
import { createDb, type Db } from './db.ts'
import { currentUser, queue, type Env } from './http.ts'
import { hideLayers, layerRoutes } from './layer-routes.ts'
import { LayersRepo } from './layers.ts'
import { createMailer } from './mail.ts'
import { migrateToLatest } from './migrate.ts'
import { notificationRoutes, sendQueued, settingsLink } from './notify.ts'
import { rateLimit, RATE_LIMIT } from './rate-limit.ts'
import { requestRoutes } from './requests.ts'
import { userRoutes } from './user-routes.ts'

export interface AppOptions {
    // How many changes each address can make to the API a minute, or false
    // for no limit. Limited in production.
    rateLimit?: typeof RATE_LIMIT | false
    // The site's own address (MAIL_FROM), which hears about new layers
    // waiting for approval.
    mailFrom?: string
}

export function createApp(auth: Auth, db: Db, repo: LayersRepo, siteUrl: string, options: AppOptions = {}) {
    const limits = options.rateLimit ?? (process.env.NODE_ENV === 'production' && RATE_LIMIT)
    const app = new Hono().basePath('/api')
    app.get('/', c => c.json({ hello: 'Elgeis' }))
    app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))

    const deps = { db, repo, siteUrl, serially: queue(), secret: auth.options.secret!, mailFrom: options.mailFrom }
    const requests = requestRoutes(deps)
    const api = new Hono<Env>()
    if (limits) api.use(rateLimit(db, limits))
    api.use(currentUser(auth))
    api.route('/', requests.app)
    api.route('/', layerRoutes(deps, requests))
    api.route('/', userRoutes(deps))
    api.route('/', notificationRoutes(db, auth.options.secret!))
    app.route('/', api)

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

    const hidden = await db.selectFrom('layer').select('id').where(eb => eb.or([eb('hidden', '=', true), eb('pending', '=', true)])).execute()
    const repo = new LayersRepo(env.LAYERS_REPO!, env.LAYERS_BUILD!, env.LAYERS_REMOTE!, new Set(hidden.map(l => l.id)))
    // Pending layers, and banned accounts', too, which needs to know which are official.
    await hideLayers(db, repo)
    const sendMail = createMailer(env.SMTP_URL!, env.MAIL_FROM!)
    const auth = createAuth(db, { siteUrl: env.SITE_URL!, secret: env.BETTER_AUTH_SECRET!, sendMail })
    const { app, reconcile } = createApp(auth, db, repo, env.SITE_URL!, { mailFrom: env.MAIL_FROM })
    // Also gives every layer in the repo a row, for its admins and change requests.
    await reconcile()
    // Pick up edits made to the layers remote directly.
    setInterval(() => reconcile().catch(e => console.error('Catching up with the layers repo failed:', e)), 5 * 60 * 1000)
    // Send queued notifications. One run at a time, so none goes out twice.
    let sending = false
    setInterval(async () => {
        if (sending) return
        sending = true
        await sendQueued(db, sendMail, id => settingsLink(env.SITE_URL!, env.BETTER_AUTH_SECRET!, id)).catch(e => console.error('Sending notifications failed:', e)).finally(() => { sending = false })
    }, 10 * 1000)
    const port = Number(env.PORT ?? 3000)
    serve({ fetch: app.fetch, port }, () => console.log(`Listening on port ${port}`))
}
