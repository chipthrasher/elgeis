import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { objectVersion, type Op } from '../shared/changes.ts'
import { formatJson } from '../shared/format.ts'
import type { LayerObject } from '../shared/layer.ts'
import { testApp } from './test-app.ts'
import { skip } from './test-db.ts'
import { git, NATION, POLYGON } from './test-layers.ts'

const recolor = (color: string): Op => ({
    op: 'update',
    baseVersion: objectVersion(NATION),
    object: { ...NATION, properties: { ...NATION.properties, color } },
})

async function setup() {
    const t = await testApp()
    const steve = await t.signIn('steve@example.com', 'steve')
    const admin = await t.signIn('admin@example.com', 'admin')
    await t.db.updateTable('user').set({ role: 'admin' }).where('username', '=', 'admin').execute()
    return { ...t, steve, admin }
}

const json = async (response: Response) => {
    const body = await response.json()
    return { ...body, code: response.status }
}

test('draft, edit, submit, and approve a change request', { skip }, async () => {
    const { steve, admin, layers: { dir, remote, build } } = await setup()
    const layer = await json(await steve('/api/layers/political'))
    assert.equal(layer.objects.length, 2)
    assert.equal(layer.canReview, false)

    let request = await json(await steve('/api/requests', { layerId: 'political', title: '', ops: [recolor('#00ff00')] }))
    assert.equal(request.code, 201)
    assert.equal(request.author, 'steve')
    assert.equal(request.mine, true)

    // Untitled requests can't be submitted.
    assert.equal((await steve(`/api/requests/${request.id}/submit`, {})).status, 400)
    request = await json(await steve(`/api/requests/${request.id}`, { title: 'Recolor Adfelis', ops: [recolor('#00ff00')] }, 'PUT'))
    assert.equal(request.title, 'Recolor Adfelis')

    // Only submitted requests can be reviewed, and only by reviewers.
    assert.equal((await admin(`/api/requests/${request.id}/approve`, {})).status, 409)
    request = await json(await steve(`/api/requests/${request.id}/submit`, {}))
    assert.equal(request.status, 'submitted')
    assert.equal((await steve(`/api/requests/${request.id}/approve`, {})).status, 403)

    const queue = await (await admin('/api/requests?review')).json()
    assert.deepEqual(queue.map((r: { id: number }) => r.id), [request.id])

    request = await json(await admin(`/api/requests/${request.id}/approve`, { comment: 'Thanks!' }))
    assert.equal(request.status, 'approved')
    assert.equal(request.reviewedBy, 'admin')
    assert.deepEqual(request.comments.map((c: { author: string, body: string }) => [c.author, c.body]), [['admin', 'Thanks!']])
    assert.match(request.commit, /^[0-9a-f]{40}$/)

    // It's committed with steve as author, built, and pushed.
    assert.equal(git(dir, 'log', '-1', '--format=%an <%ae>').trim(), 'steve <steve@users.noreply.map.test>')
    assert.match(git(dir, 'log', '-1', '--format=%B'), /^Recolor Adfelis\n\nApproved by admin\.\n\nChange-Request: \d+\nApproved-By: admin/)
    assert.equal(git(remote, 'rev-parse', 'HEAD').trim(), request.commit)
    assert.match(fs.readFileSync(path.join(build, 'political.json'), 'utf8'), /#00ff00/)
    assert.equal(git(dir, 'show', 'HEAD:political/ent_a.json'), formatJson((recolor('#00ff00') as { object: LayerObject }).object))
})

test('invalid ops are refused', { skip }, async () => {
    const { steve } = await setup()
    const create = (ops: unknown[]) => steve('/api/requests', { layerId: 'political', title: 'x', ops })
    assert.equal((await create([])).status, 400)
    assert.equal((await create([{ op: 'move' }])).status, 400)
    assert.equal((await create([recolor('red')])).status, 400)
    assert.equal((await create([recolor('#00ff00'), recolor('#0000ff')])).status, 400) // same object twice
    assert.equal((await create([{ op: 'delete', id: 'ent_a', baseVersion: objectVersion(NATION) }])).status, 400) // its polygon lists it
    assert.equal((await create([{ op: 'delete', id: 'ent_a', baseVersion: 'old' }, { op: 'delete', id: 'pol_a', baseVersion: objectVersion(POLYGON) }])).status, 400)
    assert.equal((await create([{ op: 'add', object: { ...NATION, id: 'ent_b' } }])).status, 400) // duplicate name
    // Entities are listed by ID, not name.
    assert.equal((await create([{ op: 'update', baseVersion: objectVersion(POLYGON), object: { ...POLYGON, properties: { entities: ['Adfelis'] } } }])).status, 400)
    // So renaming a nation touches only the nation.
    assert.equal((await create([{ op: 'update', baseVersion: objectVersion(NATION), object: { ...NATION, properties: { name: 'Emeraldia' } } }])).status, 201)
    assert.equal((await steve('/api/requests', { layerId: 'nope', title: 'x', ops: [recolor('#0000ff')] })).status, 400)

    const response = await create([{ op: 'delete', id: 'ent_a', baseVersion: objectVersion(NATION) }, { op: 'delete', id: 'pol_a', baseVersion: objectVersion(POLYGON) }])
    assert.equal(response.status, 201)

    const signedOut = (await testApp()).browser()
    assert.equal((await signedOut('/api/requests', { layerId: 'political', title: 'x', ops: [recolor('#0000ff')] })).status, 401)
})

test('at most 10 open requests each, and withdrawing frees one up', { skip }, async () => {
    const { steve } = await setup()
    const ids: number[] = []
    for (let i = 0; i < 10; i++) {
        const r = await (await steve('/api/requests', { layerId: 'political', title: `${i}`, ops: [recolor(`#00000${i}`)] })).json() // eslint-disable-line no-await-in-loop
        ids.push(r.id)
    }
    const eleventh = await json(await steve('/api/requests', { layerId: 'political', title: 'x', ops: [recolor('#0000ff')] }))
    assert.equal(eleventh.code, 409)
    assert.match(eleventh.message, /at most 10/)

    assert.equal((await json(await steve(`/api/requests/${ids[0]}/withdraw`, {}))).code, 200)
    assert.equal((await steve(`/api/requests/${ids[0]}`, { title: 'x', ops: [recolor('#0000ff')] }, 'PUT')).status, 409)
    assert.equal((await steve('/api/requests', { layerId: 'political', title: 'x', ops: [recolor('#0000ff')] })).status, 201)
})

test('approving one request makes others on the same object stale', { skip }, async () => {
    const { steve, admin } = await setup()
    const submit = async (op: Op) => {
        const r = await (await steve('/api/requests', { layerId: 'political', title: 'x', ops: [op] })).json()
        return (await steve(`/api/requests/${r.id}/submit`, {})).json()
    }
    const first = await submit(recolor('#00ff00'))
    const second = await submit(recolor('#0000ff'))
    const other = await submit({ op: 'update', baseVersion: objectVersion(POLYGON), object: { ...POLYGON, properties: { entities: ['ent_a'], hidden: true } } })

    await admin(`/api/requests/${first.id}/approve`, {})
    assert.equal((await (await steve(`/api/requests/${second.id}`)).json()).status, 'stale')
    assert.equal((await (await steve(`/api/requests/${other.id}`)).json()).status, 'submitted')
    assert.equal((await admin(`/api/requests/${second.id}/approve`, {})).status, 409)

    // The author updates it against the new version and resubmits.
    const green = (recolor('#00ff00') as { object: LayerObject }).object
    const updated = { op: 'update', baseVersion: objectVersion(green), object: { ...green, properties: { ...green.properties, color: '#0000ff' } } }
    assert.equal((await json(await steve(`/api/requests/${second.id}`, { title: 'x', ops: [updated] }, 'PUT'))).code, 200)
    assert.equal((await json(await steve(`/api/requests/${second.id}/submit`, {}))).code, 200)
    assert.equal((await json(await admin(`/api/requests/${second.id}/approve`, {}))).code, 200)
})

test('reject with a comment, and drafts stay private', { skip }, async () => {
    const { steve, admin, browser } = await setup()
    const draft = await (await steve('/api/requests', { layerId: 'political', title: 'x', ops: [recolor('#0000ff')] })).json()
    assert.equal((await browser()(`/api/requests/${draft.id}`)).status, 404)
    assert.equal((await admin(`/api/requests/${draft.id}`)).status, 200)

    await steve(`/api/requests/${draft.id}/submit`, {})
    assert.equal((await browser()(`/api/requests/${draft.id}`)).status, 200)
    const rejected = await json(await admin(`/api/requests/${draft.id}/reject`, { comment: 'Not a real nation' }))
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.comments[0].body, 'Not a real nation')
    assert.equal((await steve(`/api/requests/${draft.id}/withdraw`, {})).status, 409)

    const mine = await (await steve('/api/requests?mine')).json()
    assert.deepEqual(mine.map((r: { status: string }) => r.status), ['rejected'])
})

test('on startup, requests committed but not marked approved are marked', { skip }, async () => {
    const { steve, db, layers: { repo, dir }, reconcile } = await setup()
    const r = await (await steve('/api/requests', { layerId: 'political', title: 'Rename', ops: [recolor('#00ff00')] })).json()
    await steve(`/api/requests/${r.id}/submit`, {})
    // As if the backend stopped right after committing.
    const op = recolor('#00ff00') as { object: LayerObject }
    repo.commit({
        layers: [{ layer: repo.data[0].layer, objects: [op.object, POLYGON] }],
        changed: new Map([['political', ['ent_a']]]),
        author: { name: 'steve', email: 'steve@example.com' },
        message: `Rename\n\nChange-Request: ${r.id}\nApproved-By: admin\n`,
    })
    await reconcile()
    const request = await db.selectFrom('changeRequest').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow()
    assert.equal(request.status, 'approved')
    assert.equal(request.commit, git(dir, 'rev-parse', 'HEAD').trim())
    assert.ok(request.reviewedBy)
})

test("approving pulls in the remote's edits first, so it doesn't overwrite them", { skip }, async () => {
    const { steve, admin, db, layers: { remote, repo }, reconcile } = await setup()
    const r = await (await steve('/api/requests', { layerId: 'political', title: 'Recolor', ops: [recolor('#00ff00')] })).json()
    await steve(`/api/requests/${r.id}/submit`, {})

    // Someone edits the same nation on the remote by hand.
    fs.writeFileSync(path.join(remote, 'political', 'ent_a.json'), formatJson({ ...NATION, properties: { ...NATION.properties, color: '#0000ff' } }))
    git(remote, 'add', '--all')
    git(remote, '-c', 'user.name=B', '-c', 'user.email=b@example.com', 'commit', '--quiet', '--message=By hand')

    assert.equal((await admin(`/api/requests/${r.id}/approve`, {})).status, 409)
    assert.equal(repo.data[0].objects.find(o => o.id === 'ent_a')!.properties.color, '#0000ff')
    const request = await db.selectFrom('changeRequest').select('status').where('id', '=', r.id).executeTakeFirstOrThrow()
    assert.equal(request.status, 'stale')

    // Catching up again finds nothing new.
    await reconcile()
    assert.equal(git(remote, 'log', '-1', '--format=%s').trim(), 'By hand')
})
