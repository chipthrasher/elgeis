// The whole API for tests: a fresh database, a layers repo, and browsers that
// keep their own cookies.

import { createAuth } from './auth.ts'
import { createApp, type AppOptions } from './main.ts'
import { testDb } from './test-db.ts'
import { testRepo } from './test-layers.ts'

export const SITE = 'http://map.test'

export async function testApp(options: AppOptions = {}) {
    const db = await testDb()
    const layers = testRepo()
    await db.insertInto('layer').values({ id: 'political' }).execute()
    const mail: { to: string, text: string }[] = []
    const auth = createAuth(db, {
        siteUrl: SITE,
        secret: 'test-secret-that-is-long-enough-to-use',
        sendMail: async (to, _subject, text) => { mail.push({ to, text }) },
    })
    const { app, reconcile } = createApp(auth, db, layers.repo, SITE, { mailFrom: 'Elgeis Map <map@example.com>', ...options })

    // A tiny browser: keeps cookies and sends the site's Origin.
    function browser() {
        let cookie = ''
        return async function request(path: string, body?: object, method = body ? 'POST' : 'GET') {
            const response = await app.request(SITE + path, {
                method,
                headers: { cookie, origin: SITE, 'content-type': 'application/json' },
                body: body && JSON.stringify(body),
                redirect: 'manual',
            })
            const set = response.headers.getSetCookie().map(c => c.split(';')[0])
            if (set.length) cookie = set.join('; ')
            return response
        }
    }
    type Browser = ReturnType<typeof browser>

    // Sign in with an email link, in a new browser.
    async function signIn(email: string, username?: string): Promise<Browser> {
        const request = browser()
        await request('/api/auth/sign-in/magic-link', { email })
        const link = new URL(mail.at(-1)!.text.match(/http\S+/)![0])
        await request(link.pathname + link.search)
        if (username) await request('/api/auth/update-user', { username, displayUsername: username, name: username })
        return request
    }

    return { db, auth, mail, layers, reconcile, browser, signIn }
}
