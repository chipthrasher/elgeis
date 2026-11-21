// Accounts, for site admins: listing them, and banning and unbanning them.
// Banned accounts are signed out and can't sign in again (Better Auth's admin
// plugin checks), can't do anything through the API (see currentUser), and
// their community layers are hidden until they're unbanned.

import { Hono } from 'hono'
import { z } from 'zod'
import { fail, parseBody, siteAdmin, type Env } from './http.ts'
import { hideLayers } from './layer-routes.ts'
import type { Deps } from './requests.ts'

const PAGE = 50

export function userRoutes({ db, repo, serially }: Deps) {
    const app = new Hono<Env>()

    // Newest first, a page at a time, optionally only those whose username or
    // email holds `q`, or only banned ones.
    app.get('/users', async c => {
        siteAdmin(c)
        const q = c.req.query('q')?.trim()
        const offset = Math.max(0, Math.floor(Number(c.req.query('offset'))) || 0)
        let query = db.selectFrom('user')
            .select(eb => ['id', 'username', 'displayUsername', 'email', 'createdAt', 'banned', 'banReason',
                eb.selectFrom('layer').whereRef('layer.createdBy', '=', 'user.id').select(eb.fn.countAll<string>().as('n')).as('layers')])
            .orderBy('createdAt', 'desc').orderBy('id').offset(offset).limit(PAGE + 1)
        if (q) {
            const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
            query = query.where(eb => eb.or([eb('username', 'ilike', like), eb('email', 'ilike', like)]))
        }
        if (c.req.query('banned') === 'true') query = query.where('banned', '=', true)
        const rows = await query.execute()
        return c.json({
            users: rows.slice(0, PAGE).map(({ displayUsername, banned, layers, ...u }) =>
                ({ ...u, username: displayUsername ?? u.username, banned: !!banned, layers: Number(layers) })),
            more: rows.length > PAGE,
        })
    })

    app.post('/users/:id/banned', async c => {
        const admin = siteAdmin(c)
        const { banned, reason } = await parseBody(c, z.object({ banned: z.boolean(), reason: z.string().trim().max(500).optional() }).strict())
        const id = c.req.param('id')
        if (id === admin.id) throw fail(409, "You can't ban yourself")
        const user = await db.updateTable('user').set({ banned, banReason: banned ? reason || null : null, banExpires: null })
            .where('id', '=', id).returning('id').executeTakeFirst()
        if (!user) throw fail(404, 'No such user')
        if (banned) await db.deleteFrom('session').where('userId', '=', id).execute()
        await serially(() => hideLayers(db, repo))
        return c.json({ banned })
    })

    return app
}
