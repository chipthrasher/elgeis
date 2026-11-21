import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'kysely'
import { pruneAudit } from './audit.ts'
import { testApp } from './test-app.ts'
import { skip } from './test-db.ts'

const linkIn = (text: string) => {
    const link = new URL(text.match(/http\S+/)![0])
    return link.pathname + link.search
}

test('the audit log records account events and changes, for site admins only', { skip }, async () => {
    const { db, mail, browser, signIn } = await testApp()
    const alex = browser()
    await alex('/api/auth/sign-up/email', { email: 'alex@example.com', password: 'correct horse', name: 'alex', username: 'alex' })
    await alex(linkIn(mail[0].text))
    assert.equal((await browser()('/api/auth/sign-in/username', { username: 'alex', password: 'wrong password' })).status, 401)
    const layer = await (await alex('/api/layers', { name: 'Farms', dimension: 'overworld' })).json()
    assert.equal((await alex('/api/layers/political/hidden', { hidden: true })).status, 403)
    await alex('/api/auth/sign-out', {})

    const admin = await signIn('boss@example.com', 'boss')
    await db.updateTable('user').set({ role: 'admin' }).where('username', '=', 'boss').execute()

    const rows = await db.selectFrom('auditLog').select(['username', 'action', 'target', 'status']).orderBy('id').execute()
    assert.deepEqual(rows, [
        { username: 'alex', action: 'create account', target: { email: 'alex@example.com' }, status: 200 },
        { username: null, action: 'POST /auth/sign-up/email', target: { email: 'alex@example.com', username: 'alex' }, status: 200 },
        { username: 'alex', action: 'GET /auth/verify-email', target: {}, status: 302 },
        // Failed sign-ins say who was tried, and never the password.
        { username: null, action: 'POST /auth/sign-in/username', target: { username: 'alex' }, status: 401 },
        { username: 'alex', action: 'POST /layers', target: { id: layer.id }, status: 201 },
        { username: 'alex', action: 'POST /layers/:id/hidden', target: { id: 'political' }, status: 403 },
        { username: null, action: 'POST /auth/sign-in/magic-link', target: { email: 'boss@example.com' }, status: 200 },
        { username: null, action: 'create account', target: { email: 'boss@example.com' }, status: 200 },
        { username: null, action: 'GET /auth/magic-link/verify', target: { email: 'boss@example.com' }, status: 302 },
        { username: 'boss', action: 'POST /auth/update-user', target: { username: 'boss' }, status: 200 },
    ])

    assert.equal((await alex('/api/audit')).status, 401) // signed out
    assert.equal((await (await signIn('steve@example.com', 'steve'))('/api/audit')).status, 403)
    const page = await (await admin('/api/audit')).json()
    assert.equal(page.entries[0].action, 'POST /auth/update-user') // newest first
    assert.equal(page.more, false)
    const failed = await (await admin('/api/audit?failed=true')).json()
    assert.deepEqual(failed.entries.map((e: { action: string }) => e.action), ['POST /layers/:id/hidden', 'POST /auth/sign-in/username'])
    const political = await (await admin('/api/audit?q=political')).json()
    assert.deepEqual(political.entries.map((e: { action: string }) => e.action), ['POST /layers/:id/hidden'])
    const older = await (await admin(`/api/audit?before=${failed.entries[1].id}`)).json()
    assert.equal(older.entries.length, 3)
})

test('entries are kept for a year', { skip }, async () => {
    const { db } = await testApp()
    await db.insertInto('auditLog').values([
        { ip: 'x', action: 'old', target: '{}', status: 200, createdAt: sql<Date>`now() - interval '366 days'` },
        { ip: 'x', action: 'new', target: '{}', status: 200, createdAt: sql<Date>`now() - interval '364 days'` },
    ]).execute()
    await pruneAudit(db)
    assert.deepEqual((await db.selectFrom('auditLog').select('action').execute()).map(r => r.action), ['new'])
})
