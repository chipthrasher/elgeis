import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMigrations } from 'better-auth/db/migration'
import { seed } from './seed.ts'
import { SITE, testApp } from './test-app.ts'
import { skip } from './test-db.ts'

test("migrations create everything Better Auth's plugins need", { skip }, async () => {
    const { auth } = await testApp()
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options)
    assert.deepEqual([...toBeCreated, ...toBeAdded], [])
})

test('sign in with an email link, pick a username, and sign out', { skip }, async () => {
    const { mail, browser } = await testApp()
    const request = browser()
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
    // Display names go into git as commit authors.
    assert.equal((await request('/api/auth/update-user', { username: 'steve_1', displayUsername: 'Steve <x@y>' })).status, 400)
    assert.equal((await request('/api/auth/update-user', { username: 'Steve_1', displayUsername: 'Steve_1', name: 'Steve_1' })).status, 200)
    session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.username, 'steve_1')
    assert.equal(session.user.displayUsername, 'Steve_1')

    await request('/api/auth/sign-out', {})
    assert.equal(await (await request('/api/auth/get-session')).json(), null)
})

test('seeded users can sign in, and the admin is a site admin', { skip }, async () => {
    const { db, signIn } = await testApp()
    await seed(db)
    await seed(db) // again, harmlessly

    const request = await signIn('admin@example.com')
    const session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.username, 'admin')
    assert.equal(session.user.role, 'admin')

    const users = await (await request('/api/auth/admin/list-users')).json()
    assert.equal(users.total, 2)
})
