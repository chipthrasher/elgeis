import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildLayers } from './build-layers.ts'

// Write a layers folder from { 'layer/file.json': json } and return its path.
function fixture(files: Record<string, object>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
    for (const [name, json] of Object.entries(files)) {
        fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), JSON.stringify(json))
    }
    return dir
}

const manifest = {
    id: 'political',
    name: 'Political',
    dimension: 'overworld',
    titleField: 'name',
    fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'entity', label: 'Nation', type: 'reference' }],
}
const nation = { type: 'Feature', id: 'ent_a', geometry: null, properties: { name: 'Adfelis' } }
const polygon = {
    type: 'Feature',
    id: 'pol_a',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
    properties: { entity: 'ent_a' },
}
const hidden = { ...polygon, id: 'pol_b', properties: { entity: 'ent_a', hidden: true } }

test('builds visible objects and an index', () => {
    const src = fixture({
        'political/layer.json': manifest,
        'political/ent_a.json': nation,
        'political/pol_a.json': polygon,
        'political/pol_b.json': hidden,
    })
    const out = path.join(src, 'out')
    buildLayers(src, out)

    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')), [manifest])
    const built = JSON.parse(fs.readFileSync(path.join(out, 'political.json'), 'utf8'))
    assert.deepEqual(built.features.map((f: { id: string }) => f.id), ['ent_a', 'pol_a'])
})

test('reports every problem at once', () => {
    const src = fixture({
        'political/layer.json': manifest,
        'political/pol_a.json': polygon, // references ent_a, which is missing
        'political/pol_c.json': { ...polygon, id: 'pol_d' }, // wrong file name, duplicate reference
        'nether/layer.json': { ...manifest, id: 'wrong' },
    })
    assert.throws(() => buildLayers(src, path.join(src, 'out')), (e: Error) => {
        assert.match(e.message, /doesn't match its folder "nether"/)
        assert.match(e.message, /pol_c\.json: File name doesn't match ID "pol_d"/)
        assert.match(e.message, /References missing object "ent_a"/)
        return true
    })
    assert.ok(!fs.existsSync(path.join(src, 'out')))
})
