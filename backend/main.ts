// The API server. Caddy routes /api here; everything else is static files.

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { initLayers } from './layers.ts'

export const app = new Hono().basePath('/api')

app.get('/', c => c.json({ hello: 'Elgeis' }))

if (import.meta.main) {
    const env = process.env
    initLayers(env.LAYERS_REPO ?? 'data/layers', 'layers', env.LAYERS_BUILD ?? 'dist/layers')
    const port = Number(env.PORT ?? 3000)
    serve({ fetch: app.fetch, port }, () => console.log(`Listening on port ${port}`))
}
