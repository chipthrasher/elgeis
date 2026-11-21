// What the API's routes share: who's signed in, who can do what, errors, and
// reading request bodies.

import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Auth } from './auth.ts'
import type { Db } from './db.ts'

export interface User {
    id: string
    username: string
    role: string | null
}

export type Env = { Variables: { user: User | null } }

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string) => new HTTPException(status, { message })

// Sets the signed-in user, if they've picked a username and aren't banned.
export const currentUser = (auth: Auth): MiddlewareHandler<Env> => async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    const u = session?.user as { id: string, username?: string | null, role?: string | null, banned?: boolean | null } | undefined
    c.set('user', u?.username && !u.banned ? { id: u.id, username: u.username, role: u.role ?? null } : null)
    await next()
}

// The client's address. Caddy passes it on in X-Forwarded-For, having checked
// it against TRUSTED_PROXIES, and the backend isn't reachable except through Caddy.
export const clientIp = (headers: Headers | undefined) => headers?.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'

export function signedIn(c: Context<Env>) {
    const user = c.get('user')
    if (!user) throw fail(401, 'Sign in and pick a username first')
    return user
}

export const isSiteAdmin = (user: User | null) => user?.role === 'admin'

export function siteAdmin(c: Context<Env>) {
    const user = signedIn(c)
    if (!isSiteAdmin(user)) throw fail(403, 'Only site admins can do that')
    return user
}

// Layer admins, and site admins, review a layer's change requests and edit
// its schema and admins.
export async function isLayerAdmin(db: Db, user: User | null, layerId: string) {
    if (!user) return false
    if (isSiteAdmin(user)) return true
    return !!await db.selectFrom('layerAdmin').select('userId').where('layerId', '=', layerId).where('userId', '=', user.id).executeTakeFirst()
}

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
    const result = schema.safeParse(await c.req.json().catch(() => null))
    if (!result.success) throw fail(400, z.prettifyError(result.error))
    return result.data
}

// Runs functions one at a time, in order, so two can't touch the layers repo
// at once.
export function queue() {
    let last: Promise<unknown> = Promise.resolve()
    return function serially<T>(fn: () => Promise<T>): Promise<T> {
        const run = last.then(fn)
        last = run.catch(() => {})
        return run
    }
}
export type Serially = ReturnType<typeof queue>
