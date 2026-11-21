import { test } from 'node:test'
import assert from 'node:assert/strict'
import { objectVersion, type Op } from '../shared/changes.ts'
import { sendQueued, settingsLink } from './notify.ts'
import { SITE, testApp } from './test-app.ts'
import { skip } from './test-db.ts'
import { NATION } from './test-layers.ts'

const recolor = (color: string): Op => ({ op: 'update', baseVersion: objectVersion(NATION), object: { ...NATION, properties: { ...NATION.properties, color } } })

test('reviewers hear about submitted requests, and authors about what happens to them', { skip }, async () => {
    const { db, signIn } = await testApp()
    const steve = await signIn('steve@example.com', 'steve')
    const alex = await signIn('alex@example.com', 'alex')
    const admin = await signIn('admin@example.com', 'admin')
    await db.updateTable('user').set({ role: 'admin' }).where('username', '=', 'admin').execute()
    const sent: { to: string, subject: string, text: string, headers?: Record<string, string> }[] = []
    const send = async () => {
        sent.length = 0
        await sendQueued(db, async (to, subject, text, headers) => { sent.push({ to, subject, text, headers }) }, id => `link-for-${id}`)
        return sent.map(m => m.to)
    }
    await send() // the sign-in emails aren't queued, so nothing

    const submit = async (title: string, color: string) => {
        const r = await (await steve('/api/requests', { layerId: 'political', title, ops: [recolor(color)] })).json()
        await steve(`/api/requests/${r.id}/submit`, {})
        return r.id
    }
    // With no layer admins, site admins are asked.
    const green = await submit('Green', '#00ff00')
    assert.deepEqual(await send(), ['admin@example.com'])
    assert.match(sent[0].text, new RegExp(`steve asks you to review .*\\n\\nhttp://map.test/\\?request=${green}\\n`))

    // Otherwise the layer's admins, but not the author.
    await admin('/api/layers/political/admins', { username: 'alex' })
    await admin('/api/layers/political/admins', { username: 'steve' })
    await submit('Blue', '#0000ff')
    assert.deepEqual(await send(), ['alex@example.com'])

    const red = await submit('Red', '#ff0000')
    await send()
    await alex(`/api/requests/${red}/reject`, { comment: 'No' })
    assert.deepEqual(await send(), ['steve@example.com'])
    assert.match(sent[0].text, /alex didn't approve .*They said: No/s)

    // Approving one makes the other stale.
    await alex(`/api/requests/${green}/approve`, { comment: 'Nice' })
    assert.deepEqual(await send(), ['steve@example.com', 'steve@example.com'])
    assert.deepEqual(sent.map(m => m.subject), ['Your change "Blue" needs updating', 'Your change "Green" is on the map'])
    assert.match(sent[1].text, /alex approved .*They said: Nice/s)
})

test("failed emails are retried, and given up on after a few tries", { skip }, async () => {
    const { db, signIn } = await testApp()
    await signIn('steve@example.com', 'steve')
    const { id } = await db.selectFrom('user').select('id').executeTakeFirstOrThrow()
    await db.insertInto('emailQueue').values({ userId: id, subject: 's', text: 't' }).execute()
    let tries = 0
    for (let i = 0; i < 7; i++) await sendQueued(db, async () => { tries++; throw new Error('SMTP is down') }, () => '') // eslint-disable-line no-await-in-loop
    assert.equal(tries, 5)
    const mail = await db.selectFrom('emailQueue').selectAll().executeTakeFirstOrThrow()
    assert.equal(mail.sentAt, null)
    assert.equal(mail.lastError, 'SMTP is down')
})

test('each address can only make so many changes a minute', { skip }, async () => {
    const { signIn } = await testApp({ rateLimit: { max: 3, windowMs: 60 * 1000 } })
    const steve = await signIn('steve@example.com', 'steve')
    const create = () => steve('/api/requests', { layerId: 'political', title: 'x', ops: [] })
    for (let i = 0; i < 3; i++) assert.equal((await create()).status, 400) // eslint-disable-line no-await-in-loop
    assert.equal((await create()).status, 429)
    // Reading isn't limited.
    assert.equal((await steve('/api/requests?mine')).status, 200)
})

test('anyone can turn notifications off, signed in or from the link in an email', { skip }, async () => {
    const { db, signIn, browser } = await testApp()
    const steve = await signIn('steve@example.com', 'steve')
    const admin = await signIn('admin@example.com', 'admin')
    await db.updateTable('user').set({ role: 'admin' }).where('username', '=', 'admin').execute()
    const sent: { to: string, text: string, headers?: Record<string, string> }[] = []
    const { id: adminId } = await db.selectFrom('user').select('id').where('username', '=', 'admin').executeTakeFirstOrThrow()
    const link = settingsLink(SITE, 'test-secret-that-is-long-enough-to-use', adminId)
    const submit = async () => {
        const r = await (await steve('/api/requests', { layerId: 'political', title: 'x', ops: [recolor('#00ff00')] })).json()
        await steve(`/api/requests/${r.id}/submit`, {})
        await steve(`/api/requests/${r.id}/withdraw`, {})
        sent.length = 0
        await sendQueued(db, async (to, _subject, text, headers) => { sent.push({ to, text, headers }) }, id => settingsLink(SITE, 'test-secret-that-is-long-enough-to-use', id))
    }

    // Each email links to the settings, and the mail client's Unsubscribe opens them.
    await submit()
    assert.equal(sent.length, 1)
    assert.ok(sent[0].text.endsWith(`To stop these emails: ${link}\n`))
    assert.deepEqual(sent[0].headers, { 'List-Unsubscribe': `<${link}>` })

    // The link's token works without signing in, but only for its own user.
    const token = new URL(link).searchParams.get('notifications')!
    const stranger = browser()
    assert.deepEqual(await (await stranger(`/api/notifications?token=${token}`)).json(), { enabled: true, email: 'admin@example.com' })
    assert.equal((await stranger(`/api/notifications?token=${token.slice(0, -2)}xx`, { enabled: false }, 'PUT')).status, 403)
    assert.equal((await stranger('/api/notifications', { enabled: false }, 'PUT')).status, 401)
    assert.equal((await stranger(`/api/notifications?token=${token}`, { enabled: false }, 'PUT')).status, 200)
    await submit()
    assert.equal(sent.length, 0)

    // Signed in, it's in your account settings.
    assert.equal((await (await admin('/api/notifications')).json()).enabled, false)
    assert.equal((await admin('/api/notifications', { enabled: true }, 'PUT')).status, 200)
    await submit()
    assert.equal(sent.length, 1)
})
