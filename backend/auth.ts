// Sign-in, sessions, and site admins, through Better Auth. People sign up with
// an email, a username, and a password, and can't sign in until they've
// clicked the link we email them. They can sign in with their email or their
// username, or with a one-time link emailed to them instead of a password.
// They can change their username, email (once they confirm the new one), and
// password.
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

// Names that would pass for the site's own staff, which nobody can take, and
// slurs, which no name can hold. Dots and underscores don't get around them.
// (Site admins' own usernames are already taken, so nobody else can have them.)
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'elgeis', 'root', 'support', 'staff', 'system', 'official']
const SLURS = ['nigger', 'nigga', 'faggot', 'retard', 'tranny', 'kike', 'cunt']
export function allowedUsername(name: string) {
    const plain = name.toLowerCase().replace(/[._]/g, '')
    return USERNAME_CHARS.test(name) && !RESERVED.includes(plain) && !SLURS.some(s => plain.includes(s))
}

export interface AuthOptions {
    siteUrl: string
    secret: string
    sendMail: (to: string, subject: string, text: string) => Promise<void>
}

const IGNORE = "If this wasn't you, you can ignore this email."

export function createAuth(db: Db, { siteUrl, secret, sendMail }: AuthOptions) {
    return betterAuth({
        baseURL: siteUrl,
        secret,
        database: { db, type: 'postgres' },
        session: { expiresIn: 365 * DAY, updateAge: DAY },
        // Limits how often each address can sign in, sign up, and send
        // email, in production. Caddy passes on the client's address in
        // X-Forwarded-For, having checked it against TRUSTED_PROXIES.
        rateLimit: { storage: 'database' },
        emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
            // Someone who reset their password because it leaked gets
            // everyone else signed out.
            revokeSessionsOnPasswordReset: true,
            // Signing up with a taken email looks like it worked, so nobody
            // can find out who has an account. The owner hears about it.
            onExistingUserSignUp: ({ user }) => sendMail(user.email, 'You already have an Elgeis Map account',
                `Someone tried to sign up for the Elgeis Map with this email, but you already have an account. ` +
                `To get in, sign in, or use "Forgot password?" to pick a new password.\n\n${IGNORE}\n`),
            // This also lets people who've only ever signed in with a link
            // set a password.
            sendResetPassword: ({ user, url }) => sendMail(user.email, 'Reset your Elgeis Map password',
                `Click this link to pick a new password for the Elgeis Map:\n\n${url}\n\n` +
                `It works once, for the next hour. ${IGNORE}\n`),
        },
        emailVerification: {
            // Sent on sign-up, on signing in before verifying, and to the new
            // address when someone changes their email.
            sendVerificationEmail: ({ user, url }) => sendMail(user.email, 'Confirm your email for the Elgeis Map',
                `Click this link to confirm this is your email on the Elgeis Map:\n\n${url}\n\n` +
                `It works for the next hour. ${IGNORE}\n`),
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
        },
        user: { changeEmail: { enabled: true } },
        plugins: [
            magicLink({
                expiresIn: 15 * 60,
                sendMagicLink: ({ email, url }) => sendMail(email, 'Sign in to the Elgeis Map',
                    `Click this link to sign in to the Elgeis Map:\n\n${url}\n\n` +
                    `It works once, for the next 15 minutes. ${IGNORE}\n`),
            }),
            // Checked on signing up and on changing usernames.
            username({ usernameValidator: allowedUsername, displayUsernameValidator: allowedUsername }),
            // Site admins (role "admin") and site-wide bans.
            admin(),
        ],
    })
}

export type Auth = ReturnType<typeof createAuth>
