// The API server. Caddy routes /api here; everything else is static files.

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createDb } from './db.ts'
import { initLayers } from './layers.ts'
import { migrateToLatest } from './migrate.ts'

export const app = new Hono().basePath('/api')

app.get('/', c => c.json({ hello: 'Elgeis' }))

if (import.meta.main) {
    const env = process.env
    const db = createDb(env.DATABASE_URL!)
    await migrateToLatest(db)

    const layers = initLayers(env.LAYERS_REPO ?? 'data/layers', 'layers', env.LAYERS_BUILD ?? 'dist/layers')
    // Every layer in the repo gets a row, for its admins and change requests.
    await db.insertInto('layer').values(layers.map(l => ({ id: l.layer.id }))).onConflict(c => c.doNothing()).execute()

    const port = Number(env.PORT ?? 3000)
    serve({ fetch: app.fetch, port }, () => console.log(`Listening on port ${port}`))
}
