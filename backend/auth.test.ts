import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMigrations } from 'better-auth/db/migration'
import { createAuth } from './auth.ts'
import { createApp } from './main.ts'
import { seed } from './seed.ts'
import { skip, testDb } from './test-db.ts'

const SITE = 'http://map.test'

async function setup() {
    const db = await testDb()
    const mail: { to: string, text: string }[] = []
    const auth = createAuth(db, {
        siteUrl: SITE,
        secret: 'test-secret-that-is-long-enough-to-use',
        sendMail: async (to, _subject, text) => { mail.push({ to, text }) },
    })
    const app = createApp(auth)

    // A tiny browser: keeps cookies and sends the site's Origin.
    let cookie = ''
    async function request(path: string, body?: object) {
        const response = await app.request(SITE + path, {
            method: body ? 'POST' : 'GET',
            headers: { cookie, origin: SITE, 'content-type': 'application/json' },
            body: body && JSON.stringify(body),
            redirect: 'manual',
        })
        const set = response.headers.getSetCookie().map(c => c.split(';')[0])
        if (set.length) cookie = set.join('; ')
        return response
    }
    return { db, auth, mail, request }
}

test("migrations create everything Better Auth's plugins need", { skip }, async () => {
    const { auth } = await setup()
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options)
    assert.deepEqual([...toBeCreated, ...toBeAdded], [])
})

test('sign in with an email link, pick a username, and sign out', { skip }, async () => {
    const { mail, request } = await setup()
    assert.equal(await (await request('/api/auth/get-session')).json(), null)

    const sent = await request('/api/auth/sign-in/magic-link', { email: 'steve@example.com', callbackURL: '/?q=x' })
    assert.equal(sent.status, 200)
    assert.equal(mail[0].to, 'steve@example.com')
    const link = new URL(mail[0].text.match(/http\S+/)![0])
    assert.equal(link.origin, SITE)

    const verified = await request(link.pathname + link.search)
    assert.equal(verified.status, 302)
    assert.equal(verified.headers.get('location'), SITE + '/?q=x')
    let session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.email, 'steve@example.com')
    assert.equal(session.user.username, null)
    // Sessions last about a year.
    assert.ok(new Date(session.session.expiresAt).getTime() - Date.now() > 300 * 24 * 60 * 60 * 1000)

    // A link works once.
    const reused = await request(link.pathname + link.search)
    assert.match(reused.headers.get('location')!, /error=/)

    assert.equal((await request('/api/auth/update-user', { username: 'x' })).status, 400) // too short
    assert.equal((await request('/api/auth/update-user', { username: 'Steve_1', displayUsername: 'Steve_1', name: 'Steve_1' })).status, 200)
    session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.username, 'steve_1')
    assert.equal(session.user.displayUsername, 'Steve_1')

    await request('/api/auth/sign-out', {})
    assert.equal(await (await request('/api/auth/get-session')).json(), null)
})

test('seeded users can sign in, and the admin is a site admin', { skip }, async () => {
    const { db, mail, request } = await setup()
    await seed(db)
    await seed(db) // again, harmlessly

    await request('/api/auth/sign-in/magic-link', { email: 'admin@example.com' })
    const link = new URL(mail[0].text.match(/http\S+/)![0])
    await request(link.pathname + link.search)
    const session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.username, 'admin')
    assert.equal(session.user.role, 'admin')

    const users = await (await request('/api/auth/admin/list-users')).json()
    assert.equal(users.total, 2)
})
