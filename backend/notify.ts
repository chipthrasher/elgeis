// Email notifications: review requests for layer admins, and approvals,
// rejections, and stale notices for authors. They're queued in Postgres and
// sent in the background, so a slow or broken mail server never holds up the
// API, and nothing is lost if the backend restarts.

import type { Db } from './db.ts'

export type SendMail = (to: string, subject: string, text: string) => Promise<void>

// How many times to try sending each email before giving up on it.
const MAX_ATTEMPTS = 5

export async function notify(db: Db, userIds: string[], subject: string, text: string) {
    if (userIds.length === 0) return
    await db.insertInto('emailQueue').values([...new Set(userIds)].map(userId => ({ userId, subject, text }))).execute()
}

// Send what's waiting, oldest first. Runs every few seconds.
export async function sendQueued(db: Db, sendMail: SendMail) {
    const waiting = await db.selectFrom('emailQueue')
        .innerJoin('user', 'user.id', 'emailQueue.userId')
        .select(['emailQueue.id', 'user.email', 'subject', 'text'])
        .where('sentAt', 'is', null).where('attempts', '<', MAX_ATTEMPTS)
        .orderBy('emailQueue.id').limit(50).execute()
    for (const mail of waiting) {
        try {
            await sendMail(mail.email, mail.subject, mail.text) // eslint-disable-line no-await-in-loop
            await db.updateTable('emailQueue').set({ sentAt: new Date() }).where('id', '=', mail.id).execute() // eslint-disable-line no-await-in-loop
        } catch (e) {
            await db.updateTable('emailQueue') // eslint-disable-line no-await-in-loop
                .set(eb => ({ attempts: eb('attempts', '+', 1), lastError: (e as Error).message }))
                .where('id', '=', mail.id).execute()
        }
    }
}
