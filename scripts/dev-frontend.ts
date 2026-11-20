// Development only (see compose.dev.yaml): rebuilds the frontend when its
// files change, and tells open pages to reload once it has. The proxy routes
// /reload here, and pages listen to it as a stream of server-sent events.
//
// Usage: node scripts/dev-frontend.ts <checkout dir>

import fs from 'node:fs'
import http from 'node:http'
import * as esbuild from 'esbuild'

const pages = new Set<http.ServerResponse>()
const reload = () => {
    for (const page of pages) page.write('data: reload\n\n')
}

http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.write('\n')
    pages.add(response)
    request.on('close', () => pages.delete(response))
}).listen(8000)

const context = await esbuild.context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'esm',
    outdir: 'dist',
    loader: { '.png': 'file' },
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'info',
    plugins: [{ name: 'reload', setup: build => build.onEnd(result => { if (!result.errors.length) reload() }) }],
})
await context.watch()

// index.html and style.css aren't bundled; the proxy serves them straight
// from the checkout. Watch the folder, since editors often save by replacing.
fs.watch(process.argv[2], (_, file) => {
    if (file === 'index.html' || file === 'style.css') reload()
})
