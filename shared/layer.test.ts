import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Layer, newId, idPrefixFor, objectSchema, referencedIds } from './layer.ts'

const layer = Layer.parse({
    id: 'nether',
    name: 'Nether Highway',
    dimension: 'nether',
    titleField: 'name',
    fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'wiki', label: 'Wiki', type: 'url' },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'national', label: 'National', type: 'flag', icon: 'flag', ring: true },
        { key: 'entity', label: 'Entity', type: 'reference' },
    ],
})
const objects = objectSchema(layer)

const portal = {
    type: 'Feature',
    id: 'pnt_abc12345',
    geometry: { type: 'Point', coordinates: [78, 428] },
    properties: { name: 'Adfelis', wiki: 'https://wiki.elgeis.com/wiki/Adfelis', entity: 'ent_xyz98765' },
}

test('newId makes prefixed random IDs', () => {
    assert.match(newId('pol'), /^pol_[0-9a-z]{8}$/)
    assert.notEqual(newId('pol'), newId('pol'))
})

test('idPrefixFor follows the geometry', () => {
    assert.equal(idPrefixFor(null), 'ent')
    assert.equal(idPrefixFor({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }), 'lin')
    assert.equal(idPrefixFor({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }] }), 'pnt')
})

test('layer manifests are checked', () => {
    const base = { id: 'x', name: 'X', dimension: 'overworld', titleField: 'name' }
    assert.ok(Layer.safeParse({ ...base, fields: [{ key: 'name', label: 'Name', type: 'text' }] }).success)
    // The title field has to exist and be text.
    assert.ok(!Layer.safeParse({ ...base, fields: [] }).success)
    assert.ok(!Layer.safeParse({ ...base, fields: [{ key: 'name', label: 'Name', type: 'flag' }] }).success)
    // No duplicate keys, no unknown icons, no icons on URLs.
    const name = { key: 'name', label: 'Name', type: 'text' }
    assert.ok(!Layer.safeParse({ ...base, fields: [name, name] }).success)
    assert.ok(!Layer.safeParse({ ...base, fields: [{ ...name, icon: 'rocket' }] }).success)
    assert.ok(!Layer.safeParse({ ...base, fields: [name, { key: 'w', label: 'W', type: 'url', icon: 'flag' }] }).success)
})

test('valid objects pass', () => {
    assert.ok(objects.safeParse(portal).success)
    assert.ok(objects.safeParse({ ...portal, properties: { ...portal.properties, hidden: true } }).success)
    assert.ok(objects.safeParse({ type: 'Feature', id: 'ent_a', geometry: null, properties: { color: '#ff3f3f' } }).success)
    assert.ok(objects.safeParse({
        ...portal,
        geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]],
        },
        id: 'pol_a',
    }).success)
})

test('invalid objects fail', () => {
    const bad = (change: object) => assert.ok(!objects.safeParse({ ...portal, ...change }).success, JSON.stringify(change))
    const props = (change: object) => bad({ properties: { ...portal.properties, ...change } })

    bad({ geometry: { type: 'Point', coordinates: [1.5, 2] } }) // not a block position
    bad({ geometry: { type: 'LineString', coordinates: [[1, 2]] } }) // too short
    bad({ id: 'pol_a', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }) // not closed
    bad({ geometry: null }) // only entities lack geometry
    bad({ id: 'Adfelis' })
    props({ unknown: 'x' })
    props({ name: '' })
    props({ wiki: 'javascript:alert(1)' })
    props({ color: 'red' })
    props({ national: 'yes' })
    props({ entity: 'Emeraldia' })
    props({ hidden: 1 })
})

test('referencedIds lists single and multiple references', () => {
    assert.deepEqual(referencedIds(layer, objects.parse(portal)), ['ent_xyz98765'])
    const disputed = { ...portal, properties: { entity: ['ent_a', 'ent_b'] } }
    assert.deepEqual(referencedIds(layer, objects.parse(disputed)), ['ent_a', 'ent_b'])
})
