import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importSheets } from './import-sheets.ts'
import { readLayers } from './build-layers.ts'

const tsv = (rows: string[][]) => rows.map(r => r.join('\t')).join('\r\n') + '\r\n'
const MAP_COLUMNS = ['Name', 'X', 'Z', 'X Connector', 'Z Connector', 'Inner Line', 'Political Entity',
    'National', 'IBWH', 'End', 'Hide', 'Warning', 'Description', 'Wiki URL']
const portal = (values: Record<string, string>) => MAP_COLUMNS.map(c => values[c] ?? '')

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'))
    fs.mkdirSync(path.join(dir, 'data'))
    fs.writeFileSync(path.join(dir, 'data/colors.tsv'), tsv([['Nation', 'Color'], ['Montrose', '#123456']]))
    fs.writeFileSync(path.join(dir, 'data/lines.tsv'), tsv([
        ['X Position 1', 'Z Position 1', 'X Position 2', 'Z Position 2', 'ID', 'Main', 'Notes'],
        ['0', '-500', '0', '500', '0v', '1', 'Central N/S'],
        ['-50', '20', '50', '20', 'spur', '0', ''],
    ]))
    fs.writeFileSync(path.join(dir, 'data/map.tsv'), tsv([
        MAP_COLUMNS,
        portal({ Name: 'Auto', X: '30', Z: '5', 'Political Entity': 'Montrose', National: '1' }),
        portal({ Name: 'Inner ', X: '10', Z: '40', 'Inner Line': 'spur', 'Political Entity': 'Nowhere' }),
        portal({ Name: 'Hidden', X: '500', Z: '500', Hide: '1', 'Wiki URL': 'not a url' }),
    ]))
    for (const layer of ['nether', 'political']) {
        fs.mkdirSync(path.join(dir, 'layers', layer), { recursive: true })
        fs.copyFileSync(path.join('layers', layer, 'layer.json'), path.join(dir, 'layers', layer, 'layer.json'))
    }
    return dir
}

test('imports portals with stored connectors, lines, and nations', (t) => {
    t.mock.method(console, 'warn', () => {})
    t.mock.method(console, 'log', () => {})
    const dir = fixture()
    importSheets(path.join(dir, 'data'), path.join(dir, 'layers'))

    const [nether, political] = readLayers(path.join(dir, 'layers'))
    const byName = (name: string) => [...nether.objects, ...political.objects].find(o => o.properties.name === name)!

    // Snaps to the nearest main line, which is vertical at x = 0.
    assert.deepEqual(byName('Auto').geometry, {
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [30, 5] }, { type: 'LineString', coordinates: [[30, 5], [0, 5]] }],
    })
    assert.equal(byName('Auto').properties.national, true)
    assert.equal(byName('Auto').properties.entity, byName('Montrose').id)
    assert.equal(byName('Montrose').properties.color, '#123456')

    // Uses its named inner line, and creates a nation that had no color.
    const inner = byName('Inner')
    assert.equal(inner.geometry?.type, 'GeometryCollection')
    assert.equal(nether.objects.find(o => o.id === inner.properties.line)?.geometry?.type, 'LineString')
    assert.equal(byName('Nowhere').properties.color, undefined)

    // Hidden rows are kept as hidden objects, minus the invalid URL.
    assert.deepEqual(byName('Hidden').properties, { name: 'Hidden', hidden: true })

    // Re-importing keeps every ID and leaves hand-made political objects alone.
    const polygon = path.join(dir, 'layers/political/pol_hand.json')
    fs.writeFileSync(polygon, JSON.stringify({
        type: 'Feature',
        id: 'pol_hand',
        properties: { entity: byName('Montrose').id },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [9, 0], [9, 9], [0, 0]]] },
    }))
    const before = fs.readdirSync(path.join(dir, 'layers/nether')).sort()
    importSheets(path.join(dir, 'data'), path.join(dir, 'layers'))
    assert.deepEqual(fs.readdirSync(path.join(dir, 'layers/nether')).sort(), before)
    assert.ok(fs.existsSync(polygon))
    assert.equal(readLayers(path.join(dir, 'layers'))[1].objects.length, 3)
})
