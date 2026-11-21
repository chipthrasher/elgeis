import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { objectVersion } from '../shared/changes.ts'
import { testApp } from './test-app.ts'
import { skip } from './test-db.ts'
import { git, MANIFEST, NATION } from './test-layers.ts'

async function setup() {
    const t = await testApp()
    const steve = await t.signIn('steve@example.com', 'steve')
    const alex = await t.signIn('alex@example.com', 'alex')
    const admin = await t.signIn('admin@example.com', 'admin')
    await t.db.updateTable('user').set({ role: 'admin' }).where('username', '=', 'admin').execute()
    return { ...t, steve, alex, admin }
}

const json = async (response: Response) => ({ ...await response.json(), code: response.status })
const index = (build: string) => JSON.parse(fs.readFileSync(path.join(build, 'index.json'), 'utf8')).map((l: { id: string }) => l.id).sort()

test('anyone can create a community layer, and becomes its admin', { skip }, async () => {
    const { steve, alex, browser, layers: { dir, remote, build } } = await setup()
    assert.equal((await browser()('/api/layers', { name: 'Farms', dimension: 'overworld' })).status, 401)
    assert.equal((await steve('/api/layers', { name: 'Two\nlines', dimension: 'overworld' })).status, 400)

    const layer = await json(await steve('/api/layers', { name: 'Farms', description: 'Public farms', dimension: 'overworld' }))
    assert.equal(layer.code, 201)
    assert.match(layer.id, /^lay_[0-9a-z]+$/)
    assert.equal(layer.official, undefined)
    assert.deepEqual(layer.fields.map((f: { key: string, type: string }) => [f.key, f.type]), [['name', 'text'], ['description', 'text'], ['color', 'color']])

    // It's committed by its creator, pushed, and built.
    assert.equal(git(dir, 'log', '-1', '--format=%an %s').trim(), 'steve Create the Farms layer')
    assert.equal(git(remote, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', 'HEAD'))
    assert.deepEqual(index(build), [layer.id, 'political'])

    assert.deepEqual(await (await steve(`/api/layers/${layer.id}/admins`)).json(), ['steve'])
    assert.equal((await json(await steve(`/api/layers/${layer.id}`))).canReview, true)
    assert.equal((await json(await alex(`/api/layers/${layer.id}`))).canReview, false)
    const list = await (await alex('/api/layers')).json()
    assert.deepEqual(list.map((l: { id: string, createdBy: string, admins: string[], canAdmin: boolean }) => [l.id, l.createdBy, l.admins, l.canAdmin]),
        [[layer.id, 'steve', ['steve'], false], ['political', null, [], false]])
    assert.equal((await (await steve('/api/layers')).json())[0].canAdmin, true)

    // Anyone can suggest changes to it, and its admin reviews them.
    const object = { type: 'Feature', id: 'pnt_farm', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'Wheat' } }
    const r = await (await alex('/api/requests', { layerId: layer.id, title: 'Add a farm', ops: [{ op: 'add', object }] })).json()
    await alex(`/api/requests/${r.id}/submit`, {})
    assert.equal((await json(await steve(`/api/requests/${r.id}/approve`, {}))).status, 'approved')
})

test("a layer's admins edit its schema and choose its other admins", { skip }, async () => {
    const { steve, alex, admin, layers: { dir } } = await setup()
    const layer = await (await steve('/api/layers', { name: 'Farms', dimension: 'overworld' })).json()
    const object = { type: 'Feature', id: 'pnt_farm', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'Wheat', description: 'Lots' } }
    const r = await (await steve('/api/requests', { layerId: layer.id, title: 'Add a farm', ops: [{ op: 'add', object }] })).json()
    await steve(`/api/requests/${r.id}/submit`, {})
    await steve(`/api/requests/${r.id}/approve`, {})

    const edit = (by: typeof steve, body: object) => by(`/api/layers/${layer.id}`, body, 'PUT')
    const schema = {
        name: 'Public farms', titleField: 'name',
        fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'crop', label: 'Crop', type: 'text', icon: 'flag' }],
    }
    assert.equal((await edit(alex, schema)).status, 403)
    assert.equal((await edit(steve, { ...schema, titleField: 'nope' })).status, 400)
    assert.equal((await edit(steve, { ...schema, fields: [...schema.fields, { key: 'crop', label: 'Again', type: 'flag' }] })).status, 400)
    // A type the objects' values don't fit is refused, changing nothing.
    const head = git(dir, 'rev-parse', 'HEAD')
    assert.equal((await edit(steve, { ...schema, fields: [...schema.fields, { key: 'description', label: 'Description', type: 'flag' }] })).status, 400)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head)

    // Whether lines take hover is a setting, off unless it's turned on.
    assert.equal((await json(await edit(steve, { name: layer.name, titleField: 'name', fields: layer.fields, hoverLines: true }))).hoverLines, true)
    assert.equal((await json(await edit(steve, { name: layer.name, titleField: 'name', fields: layer.fields }))).hoverLines, undefined)

    // So is a default color for areas, which has to be a color.
    const base = { name: layer.name, titleField: 'name', fields: layer.fields }
    assert.equal((await edit(steve, { ...base, defaultColor: 'green' })).status, 400)
    assert.equal((await json(await edit(steve, { ...base, defaultColor: '#00ff00' }))).defaultColor, '#00ff00')
    assert.equal((await json(await edit(steve, { ...base, defaultColor: '' }))).defaultColor, undefined)

    // Saving without changing anything is fine, and makes no commit.
    const untouched = git(dir, 'rev-parse', 'HEAD')
    assert.equal((await edit(steve, { name: layer.name, titleField: 'name', fields: layer.fields })).status, 200)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), untouched)

    const updated = await json(await edit(steve, schema))
    assert.equal(updated.code, 200)
    assert.equal(updated.name, 'Public farms')
    assert.equal(updated.dimension, 'overworld')
    // A dropped field is dropped from the objects too, in the same commit.
    assert.deepEqual(JSON.parse(git(dir, 'show', `HEAD:${layer.id}/pnt_farm.json`)).properties, { name: 'Wheat' })
    assert.match(git(dir, 'show', `HEAD:${layer.id}/layer.json`), /"crop"/)

    // Admins add and remove admins, but a layer keeps at least one.
    assert.equal((await alex(`/api/layers/${layer.id}/admins`, { username: 'alex' })).status, 403)
    assert.equal((await steve(`/api/layers/${layer.id}/admins`, { username: 'nobody' })).status, 404)
    assert.deepEqual(await (await steve(`/api/layers/${layer.id}/admins`, { username: 'Alex' })).json(), ['steve', 'alex'])
    assert.equal((await json(await alex(`/api/layers/${layer.id}`))).canReview, true)
    assert.deepEqual(await (await alex(`/api/layers/${layer.id}/admins/steve`, undefined, 'DELETE')).json(), ['alex'])
    assert.equal((await alex(`/api/layers/${layer.id}/admins/alex`, undefined, 'DELETE')).status, 409)
    // Site admins can manage any layer, even official ones.
    assert.deepEqual(await (await admin('/api/layers/political/admins', { username: 'steve' })).json(), ['steve'])
    const political = { ...MANIFEST, id: undefined, dimension: undefined }
    assert.equal((await steve('/api/layers/political', { ...MANIFEST, name: 'Nations' }, 'PUT')).status, 400) // can't change its ID
    assert.equal((await json(await steve('/api/layers/political', { ...political, name: 'Nations' }, 'PUT'))).name, 'Nations')
})

test('site admins mark layers official, and hide or delete community layers', { skip }, async () => {
    const { steve, alex, admin, db, layers: { build, dir } } = await setup()
    const layer = await (await steve('/api/layers', { name: 'Farms', dimension: 'overworld' })).json()

    assert.equal((await steve(`/api/layers/${layer.id}/official`, { official: true })).status, 403)
    assert.equal((await steve(`/api/layers/${layer.id}/hidden`, { hidden: true })).status, 403)
    assert.equal((await steve(`/api/layers/${layer.id}`, undefined, 'DELETE')).status, 403)

    // Hidden layers drop out of the map, and the list, except for site admins.
    assert.equal((await admin(`/api/layers/${layer.id}/hidden`, { hidden: true })).status, 200)
    assert.deepEqual(index(build), ['political'])
    assert.equal(fs.existsSync(path.join(build, `${layer.id}.json`)), false)
    assert.equal((await (await alex('/api/layers')).json()).length, 1)
    assert.equal((await (await admin('/api/layers')).json()).find((l: { id: string }) => l.id === layer.id).hidden, true)
    assert.equal((await admin(`/api/layers/${layer.id}/official`, { official: true })).status, 409)
    assert.equal((await admin(`/api/layers/${layer.id}/hidden`, { hidden: false })).status, 200)
    assert.deepEqual(index(build), [layer.id, 'political'])

    // Official layers show by default, and can't be hidden or deleted.
    assert.equal((await json(await admin(`/api/layers/${layer.id}/official`, { official: true }))).official, true)
    assert.match(git(dir, 'show', `HEAD:${layer.id}/layer.json`), /"official": true/)
    assert.equal((await admin(`/api/layers/${layer.id}/hidden`, { hidden: true })).status, 409)
    assert.equal((await admin(`/api/layers/${layer.id}`, undefined, 'DELETE')).status, 409)
    assert.equal((await json(await admin(`/api/layers/${layer.id}/official`, { official: false }))).official, undefined)

    // Deleting a layer takes its change requests with it.
    const object = { type: 'Feature', id: 'pnt_farm', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'Wheat' } }
    await alex('/api/requests', { layerId: layer.id, title: 'Add a farm', ops: [{ op: 'add', object }] })
    assert.equal((await admin(`/api/layers/${layer.id}`, undefined, 'DELETE')).status, 200)
    assert.equal(fs.existsSync(path.join(dir, layer.id)), false)
    assert.match(git(dir, 'log', '-1', '--format=%s'), /Delete the Farms layer/)
    assert.deepEqual(index(build), ['political'])
    assert.equal((await db.selectFrom('changeRequest').selectAll().execute()).length, 0)
    assert.equal((await steve(`/api/layers/${layer.id}`)).status, 404)

    // A layer whose objects another layer lists can't be deleted.
    const nations = await (await steve('/api/layers', { name: 'Nations', dimension: 'overworld' })).json()
    const r = await (await steve('/api/requests', { layerId: nations.id, title: 'x', ops: [{ op: 'add', object: { type: 'Feature', id: 'ent_b', geometry: null, properties: { name: 'Bob' } } }] })).json()
    await steve(`/api/requests/${r.id}/submit`, {})
    await steve(`/api/requests/${r.id}/approve`, {})
    const polygon = JSON.parse(git(dir, 'show', 'HEAD:political/pol_a.json'))
    const r2 = await (await steve('/api/requests', { layerId: 'political', title: 'y', ops: [{ op: 'update', baseVersion: objectVersion(polygon), object: { ...polygon, properties: { entities: ['ent_a', 'ent_b'] } } }] })).json()
    await steve(`/api/requests/${r2.id}/submit`, {})
    assert.equal((await admin(`/api/requests/${r2.id}/approve`, {})).status, 200)
    const refused = await json(await admin(`/api/layers/${nations.id}`, undefined, 'DELETE'))
    assert.equal(refused.code, 409)
    assert.match(refused.message, /missing entity "ent_b"/)
    assert.ok(fs.existsSync(path.join(dir, nations.id, 'layer.json')))
})

test('banned accounts can do nothing', { skip }, async () => {
    const { steve, admin, db } = await setup()
    const { id } = await db.selectFrom('user').select('id').where('username', '=', 'steve').executeTakeFirstOrThrow()
    assert.equal((await admin('/api/auth/admin/ban-user', { userId: id, banReason: 'Spam' })).status, 200)
    assert.equal((await steve('/api/layers', { name: 'Spam', dimension: 'overworld' })).status, 401)
    assert.equal((await steve('/api/requests', { layerId: 'political', title: 'x', ops: [{ op: 'delete', id: 'pol_a', baseVersion: objectVersion(NATION) }] })).status, 401)
})
