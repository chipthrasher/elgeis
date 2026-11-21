// Sign-in, sessions, and site admins, through Better Auth. People sign in with
// a link emailed to them, then pick a username. There are no passwords, so
// sessions last a long time.
//
// Better Auth serves its own API under /api/auth; see
// https://www.better-auth.com/docs for the endpoints.

import { betterAuth } from 'better-auth'
import { admin, magicLink, username } from 'better-auth/plugins'
import type { Db } from './db.ts'

const DAY = 60 * 60 * 24

// What usernames, and display names (a username in its own case), can hold.
// Display names go into git as commit authors, so they mustn't hold `<`, `>`,
// or newlines. Better Auth checks usernames this way already.
export const USERNAME_CHARS = /^[a-zA-Z0-9_.]+$/

export interface AuthOptions {
    siteUrl: string
    secret: string
    sendMail: (to: string, subject: string, text: string) => Promise<void>
}

export function createAuth(db: Db, { siteUrl, secret, sendMail }: AuthOptions) {
    return betterAuth({
        baseURL: siteUrl,
        secret,
        database: { db, type: 'postgres' },
        session: { expiresIn: 365 * DAY, updateAge: DAY },
        plugins: [
            magicLink({
                expiresIn: 15 * 60,
                sendMagicLink: ({ email, url }) => sendMail(email, 'Sign in to the Elgeis Map',
                    `Click this link to sign in to the Elgeis Map:\n\n${url}\n\n` +
                    `It works once, for the next 15 minutes. If you didn't ask to sign in, you can ignore this email.\n`),
            }),
            username({ displayUsernameValidator: name => USERNAME_CHARS.test(name) }),
            // Site admins (role "admin") and site-wide bans.
            admin(),
        ],
    })
}

export type Auth = ReturnType<typeof createAuth>
