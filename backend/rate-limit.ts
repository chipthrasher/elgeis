// Limits how many changes (anything but a GET) each address can make to the
// API in a minute, so nobody can flood the site, or reviewers' inboxes. Kept
// in Better Auth's rateLimit table, under keys of our own, by client address.

import { sql } from 'kysely'
import type { MiddlewareHandler } from 'hono'
import type { Db } from './db.ts'
import { clientIp, fail } from './http.ts'

export const RATE_LIMIT = { max: 60, windowMs: 60 * 1000 }

export const rateLimit = (db: Db, { max, windowMs } = RATE_LIMIT): MiddlewareHandler => async (c, next) => {
    if (c.req.method !== 'GET') {
        const ip = clientIp(c.req.raw.headers)
        const now = Date.now()
        // A fixed window per address, starting at its first request.
        const { count } = await db.insertInto('rateLimit')
            .values({ id: crypto.randomUUID(), key: `api|${ip}`, count: 1, lastRequest: now })
            .onConflict(oc => oc.column('key').doUpdateSet({
                count: sql`case when "rateLimit"."lastRequest" <= ${now - windowMs} then 1 else "rateLimit"."count" + 1 end`,
                lastRequest: sql`case when "rateLimit"."lastRequest" <= ${now - windowMs} then ${now} else "rateLimit"."lastRequest" end`,
            }))
            .returning('count').executeTakeFirstOrThrow()
        if (count > max) throw fail(429, 'Too many requests. Please try again in a minute.')
    }
    await next()
}
