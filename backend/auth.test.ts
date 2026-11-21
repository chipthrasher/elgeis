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

const linkIn = (text: string) => {
    const link = new URL(text.match(/http\S+/)![0])
    return link.pathname + link.search
}

test('sign up with a password, verify the email, and sign in with the email or username', { skip }, async () => {
    const { mail, browser } = await testApp()
    const request = browser()
    const signUp = await request('/api/auth/sign-up/email',
        { email: 'alex@example.com', password: 'correct horse', name: 'Alex_1', username: 'Alex_1', displayUsername: 'Alex_1', callbackURL: '/?q=x' })
    assert.equal(signUp.status, 200)
    // Not signed in until the email is verified.
    assert.equal(await (await request('/api/auth/get-session')).json(), null)
    assert.equal((await request('/api/auth/sign-in/username', { username: 'alex_1', password: 'correct horse' })).status, 403)
    // Signing in before verifying sends the link again.
    assert.equal(mail.length, 2)

    const verified = await request(linkIn(mail[0].text))
    assert.equal(verified.headers.get('location'), '/?q=x')
    const session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.email, 'alex@example.com')
    assert.equal(session.user.displayUsername, 'Alex_1')

    assert.equal((await browser()('/api/auth/sign-in/username', { username: 'alex_1', password: 'wrong password' })).status, 401)
    assert.equal((await browser()('/api/auth/sign-in/username', { username: 'ALEX_1', password: 'correct horse' })).status, 200)
    assert.equal((await browser()('/api/auth/sign-in/email', { email: 'alex@example.com', password: 'correct horse' })).status, 200)

    // Taken usernames are refused; taken emails look accepted, but the owner hears about it.
    assert.equal((await browser()('/api/auth/sign-up/email', { email: 'b@example.com', password: 'correct horse', name: 'alex_1', username: 'alex_1' })).status, 400)
    assert.equal((await browser()('/api/auth/sign-up/email', { email: 'alex@example.com', password: 'correct horse', name: 'other', username: 'other' })).status, 200)
    assert.equal(mail.at(-1)!.to, 'alex@example.com')
    assert.match(mail.at(-1)!.text, /already have an account/)
})

test('change your username, email, and password', { skip }, async () => {
    const { mail, signIn, browser } = await testApp()
    const request = await signIn('sam@example.com', 'sam')

    assert.equal((await request('/api/auth/update-user', { username: 'Samwise', displayUsername: 'Samwise', name: 'Samwise' })).status, 200)
    let session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.displayUsername, 'Samwise')

    // The new email only takes effect once it's confirmed.
    assert.equal((await request('/api/auth/change-email', { newEmail: 'sam@new.example', callbackURL: '/' })).status, 200)
    assert.equal(mail.at(-1)!.to, 'sam@new.example')
    session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.email, 'sam@example.com')
    await request(linkIn(mail.at(-1)!.text))
    session = await (await request('/api/auth/get-session')).json()
    assert.equal(session.user.email, 'sam@new.example')
    assert.equal(session.user.emailVerified, true)

    // Someone who's only signed in with a link sets a password by resetting it.
    assert.equal((await request('/api/auth/request-password-reset', { email: 'sam@new.example', redirectTo: '/?q=x' })).status, 200)
    const reset = await request(linkIn(mail.at(-1)!.text))
    const token = new URL(reset.headers.get('location')!).searchParams.get('token')
    assert.ok(token)
    assert.equal((await request('/api/auth/reset-password', { token, newPassword: 'first password' })).status, 200)
    // Resetting signs everyone out.
    assert.equal(await (await request('/api/auth/get-session')).json(), null)

    const again = browser()
    assert.equal((await again('/api/auth/sign-in/username', { username: 'samwise', password: 'first password' })).status, 200)
    assert.equal((await again('/api/auth/change-password', { currentPassword: 'wrong password', newPassword: 'second password' })).status, 400)
    assert.equal((await again('/api/auth/change-password', { currentPassword: 'first password', newPassword: 'second password' })).status, 200)
    assert.equal((await browser()('/api/auth/sign-in/email', { email: 'sam@new.example', password: 'second password' })).status, 200)
})
