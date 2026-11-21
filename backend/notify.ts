// Email notifications: review requests for layer admins, and approvals,
// rejections, and stale notices for authors. They're queued in Postgres and
// sent in the background, so a slow or broken mail server never holds up the
// API, and nothing is lost if the backend restarts.
//
// Anyone can turn them off. Each email links to the settings, and carries the
// same link as its List-Unsubscribe header, so a mail client's own
// Unsubscribe button opens them in the browser. The link holds a signed
// token, so it works without signing in.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Db } from './db.ts'
import { fail, parseBody, type Env } from './http.ts'

export type SendMail = (to: string, subject: string, text: string, headers?: Record<string, string>) => Promise<void>

// Signatures for links in emails, which work without signing in. Each
// message says what its link is for, so a link can't be used for anything else.
export const sign = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('base64url')
export function signed(secret: string, message: string, signature: string) {
    const expected = Buffer.from(sign(secret, message))
    const given = Buffer.from(signature)
    return given.length === expected.length && timingSafeEqual(given, expected)
}

// Tokens never expire, like most unsubscribe links. All one can do is change
// whether its user gets notifications.
export const settingsToken = (secret: string, userId: string) => `${Buffer.from(userId).toString('base64url')}.${sign(secret, 'email-settings:' + userId)}`

function userFromToken(secret: string, token: string): string | null {
    const [id, signature = ''] = token.split('.')
    const userId = Buffer.from(id, 'base64url').toString()
    return signed(secret, 'email-settings:' + userId, signature) ? userId : null
}

// Where someone changes whether they get notifications: the map, which opens
// the setting.
export const settingsLink = (siteUrl: string, secret: string, userId: string) => `${siteUrl}/?notifications=${settingsToken(secret, userId)}`

// Read and change the setting, as the signed-in user or with a token.
export function notificationRoutes(db: Db, secret: string) {
    const app = new Hono<Env>()
    function userId(c: Context<Env>) {
        const token = c.req.query('token')
        const id = token ? userFromToken(secret, token) : c.get('user')?.id
        if (!id) throw fail(token ? 403 : 401, token ? "That link doesn't work. Sign in to change your email settings." : 'Sign in first')
        return id
    }
    const current = async (id: string) => {
        const user = await db.selectFrom('user').select(['emailNotifications', 'email']).where('id', '=', id).executeTakeFirst()
        if (!user) throw fail(404, 'That account is gone')
        return { enabled: user.emailNotifications, email: user.email }
    }
    app.get('/notifications', async c => c.json(await current(userId(c))))
    app.put('/notifications', async c => {
        const id = userId(c)
        const { enabled } = await parseBody(c, z.object({ enabled: z.boolean() }).strict())
        await db.updateTable('user').set({ emailNotifications: enabled }).where('id', '=', id).execute()
        return c.json(await current(id))
    })
    return app
}

// How many times to try sending each email before giving up on it.
const MAX_ATTEMPTS = 5

// Queue an email for each of these users who hasn't turned notifications off.
export async function notify(db: Db, userIds: string[], subject: string, text: string) {
    if (userIds.length === 0) return
    const wanted = await db.selectFrom('user').select('id').where('id', 'in', userIds).where('emailNotifications', '=', true).execute()
    if (wanted.length) await db.insertInto('emailQueue').values(wanted.map(u => ({ userId: u.id, subject, text }))).execute()
}

// Queue an email to an address, like the site's own.
export async function notifyAddress(db: Db, to: string, subject: string, text: string) {
    await db.insertInto('emailQueue').values({ to, subject, text }).execute()
}

// Send what's waiting, oldest first, each to a user with a link to their
// settings. Runs every few seconds.
export async function sendQueued(db: Db, sendMail: SendMail, linkFor: (userId: string) => string) {
    const waiting = await db.selectFrom('emailQueue')
        .leftJoin('user', 'user.id', 'emailQueue.userId')
        .select(eb => ['emailQueue.id', 'emailQueue.userId', eb.fn.coalesce('emailQueue.to', 'user.email').as('email'), 'subject', 'text'])
        .where('sentAt', 'is', null).where('attempts', '<', MAX_ATTEMPTS)
        .orderBy('emailQueue.id').limit(50).execute()
    for (const mail of waiting) {
        try {
            const link = mail.userId && linkFor(mail.userId)
            await sendMail(mail.email!, mail.subject, link ? `${mail.text}\n--\nTo stop these emails: ${link}\n` : mail.text, link ? { 'List-Unsubscribe': `<${link}>` } : undefined) // eslint-disable-line no-await-in-loop
            await db.updateTable('emailQueue').set({ sentAt: new Date() }).where('id', '=', mail.id).execute() // eslint-disable-line no-await-in-loop
        } catch (e) {
            await db.updateTable('emailQueue') // eslint-disable-line no-await-in-loop
                .set(eb => ({ attempts: eb('attempts', '+', 1), lastError: (e as Error).message }))
                .where('id', '=', mail.id).execute()
        }
    }
}
