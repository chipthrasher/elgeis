// The audit log, for site admins: who did what, and when. It records every
// change made through the API (see auditApi), and every account event through
// Better Auth (see auditAuth): signing up, signing in or failing to, and
// changing a username, email, or password. It records the route and the IDs
// in it, never request bodies, so no passwords. Entries are kept for a year.

import { Hono, type MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'
import { sql } from 'kysely'
import type { Db } from './db.ts'
import { clientIp, siteAdmin, type Env } from './http.ts'

const PAGE = 100

export interface Entry {
    user?: { id: string, username?: string | null } | null
    headers?: Headers
    action: string
    target?: Record<string, string>
    status?: number
}

// Never fails what's being logged; a missing entry is better than a failed request.
export async function audit(db: Db, { user, headers, action, target = {}, status = 200 }: Entry) {
    await db.insertInto('auditLog').values({
        userId: user?.id ?? null,
        username: user?.username ?? null,
        ip: clientIp(headers),
        action,
        target: JSON.stringify(target),
        status,
    }).execute().catch(e => console.error('Writing to the audit log failed:', e))
}

// Every change (anything but a GET) to the API, refused or not, as its method
// and route, like "POST /layers/:id/admins", with the route's params. What's
// made, like a layer or a change request, is recorded by the ID it was given.
export const auditApi = (db: Db): MiddlewareHandler<Env> => async (c, next) => {
    await next()
    if (c.req.method === 'GET') return
    const target: Record<string, string> = c.req.param()
    if (c.res.status === 201) {
        const made: { id?: string | number } | null = await c.res.clone().json().catch(() => null)
        if (made?.id !== undefined) target.id = String(made.id)
    }
    await audit(db, {
        user: c.get('user'),
        headers: c.req.raw.headers,
        action: `${c.req.method} ${routePath(c, -1).replace(/^\/api/, '')}`,
        target,
        status: c.res.status,
    })
}

export const pruneAudit = (db: Db) => db.deleteFrom('auditLog').where('createdAt', '<', sql<Date>`now() - interval '1 year'`).execute()

// Newest first, a page at a time before the entry `before`, optionally only
// those whose username or target holds `q`, or only refused ones.
export function auditRoutes(db: Db) {
    const app = new Hono<Env>()
    app.get('/audit', async c => {
        siteAdmin(c)
        const q = c.req.query('q')?.trim()
        const before = Number(c.req.query('before'))
        let query = db.selectFrom('auditLog').select(['id', 'createdAt', 'username', 'ip', 'action', 'target', 'status'])
            .orderBy('id', 'desc').limit(PAGE + 1)
        if (before) query = query.where('id', '<', before)
        if (q) {
            const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
            query = query.where(eb => eb.or([eb('username', 'ilike', like), eb(sql`"target"::text`, 'ilike', like), eb('ip', 'ilike', like)]))
        }
        if (c.req.query('failed') === 'true') query = query.where('status', '>=', 400)
        const rows = await query.execute()
        return c.json({ entries: rows.slice(0, PAGE), more: rows.length > PAGE })
    })
    return app
}
