// One-time (re-runnable) import of the Google Sheet into layer folders:
//
//   map.tsv     -> Nether portals in layers/nether/, with their stored connectors
//   lines.tsv   -> highway lines in layers/nether/
//   colors.tsv  -> nations (entities) in layers/political/
//
// Re-running it keeps existing IDs, matching portals and nations by name and
// lines by position. Every Nether object and every nation is rewritten, and ones
// no longer in the Sheet are deleted; other political objects (like
// hand-drawn polygons) are left alone.
//
// Usage: node scripts/import-sheets.ts [data dir] [layers dir]

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { formatJson } from '../shared/format.ts'
import { Layer, idPrefixFor, newId, objectSchema, type Geometry, type LayerObject, type Position, type PropertyValue } from '../shared/layer.ts'

type Row = Record<string, string>

export function parseTsv(tsv: string): Row[] {
    const [header, ...lines] = tsv.replace(/\r/g, '').split('\n')
    const columns = header.split('\t')
    return lines
        .filter(line => line.trim())
        .map(line => {
            const cells = line.split('\t')
            return Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()]))
        })
}

interface Line { x1: number, z1: number, x2: number, z2: number, sheetId: string, main: boolean }

// Closest main line in one direction whose span covers the portal, within 100
// blocks. `along` is 'x' for vertical lines (constant x), 'z' for horizontal.
function closestMainLine(lines: Line[], along: 'x' | 'z', x: number, z: number): number | null {
    const [pos, cross] = along === 'x' ? [x, z] : [z, x]
    const candidates = lines
        .filter(l => l.main)
        .map(l => along === 'x'
            ? { at: l.x1, same: l.x1 === l.x2, from: l.z1, to: l.z2 }
            : { at: l.z1, same: l.z1 === l.z2, from: l.x1, to: l.x2 })
        .filter(l => l.same && Math.abs(l.at - pos) <= 100 &&
            cross >= Math.min(l.from, l.to) && cross <= Math.max(l.from, l.to))
    if (candidates.length === 0) return null
    return candidates.reduce((a, b) => Math.abs(b.at - pos) < Math.abs(a.at - pos) ? b : a).at
}

// Where a portal's connector line ends, using the same rules the map used to
// apply at render time. Null if it has no connector.
export function connectorEnd(lines: Line[], row: Row, x: number, z: number): Position | null {
    const inner = lines.find(l => l.sheetId === row['Inner Line'])
    if (inner) {
        if (inner.x1 === inner.x2) return [inner.x1, z]
        if (inner.z1 === inner.z2) return [x, inner.z1]
        return null
    }
    if (row['X Connector']) return [parseInt(row['X Connector']), z]
    if (row['Z Connector']) return [x, parseInt(row['Z Connector'])]

    const closestX = closestMainLine(lines, 'x', x, z)
    const closestZ = closestMainLine(lines, 'z', x, z)
    if (closestX === null && closestZ === null) return null
    if (closestZ === null || (closestX !== null && Math.abs(x - closestX) < Math.abs(z - closestZ))) return [closestX!, z]
    return [x, closestZ]
}

// Read the objects already in a layer folder, so re-imports can keep their IDs.
// Doesn't validate; the build does that.
function existingObjects(dir: string): LayerObject[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json') && name !== 'layer.json')
        .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
}

const lineKey = (coordinates: Position[]) => coordinates.flat().join(',')

// Portals and nations can share a name, so the key includes the ID prefix.
function keyOf(object: LayerObject): string {
    const prefix = idPrefixFor(object.geometry)
    if (object.geometry?.type === 'LineString') return prefix + ':' + lineKey(object.geometry.coordinates)
    return prefix + ':' + object.properties.name
}

// Drop empty values, so files only list the properties that are set.
function compact(properties: Record<string, PropertyValue | undefined>): Record<string, PropertyValue> {
    return Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined && v !== '' && v !== false)) as Record<string, PropertyValue>
}

export function importSheets(dataDir: string, layersDir: string): void {
    const read = (name: string) => parseTsv(fs.readFileSync(path.join(dataDir, name), 'utf8'))
    const problems: string[] = []

    const netherDir = path.join(layersDir, 'nether')
    const politicalDir = path.join(layersDir, 'political')
    const existing = [...existingObjects(netherDir), ...existingObjects(politicalDir)]
    const oldIds = new Map(existing.map(o => [keyOf(o), o.id]))

    function makeObject(geometry: Geometry | null, properties: Record<string, PropertyValue | undefined>): LayerObject {
        const object: LayerObject = { type: 'Feature', id: '', geometry, properties: compact(properties) }
        object.id = oldIds.get(keyOf(object)) ?? newId(idPrefixFor(geometry))
        return object
    }

    // Nations. Portals can name ones that have no color yet.
    const nations = new Map<string, LayerObject>()
    const nation = (name: string, color?: string) => {
        if (!nations.has(name)) nations.set(name, makeObject(null, { name, color }))
        return nations.get(name)!
    }
    for (const row of read('colors.tsv')) if (row['Nation']) nation(row['Nation'], row['Color'])

    // Highway lines.
    const lines: Line[] = []
    const lineObjects = new Map<string, LayerObject>()
    for (const row of read('lines.tsv')) {
        const [x1, z1, x2, z2] = ['X Position 1', 'Z Position 1', 'X Position 2', 'Z Position 2'].map(c => parseInt(row[c]))
        if ([x1, z1, x2, z2].some(isNaN)) {
            problems.push(`lines.tsv: skipped "${row['ID']}", which has no position`)
            continue
        }
        const line = { x1, z1, x2, z2, sheetId: row['ID'], main: row['Main'] === '1' }
        lines.push(line)
        lineObjects.set(line.sheetId, makeObject(
            { type: 'LineString', coordinates: [[x1, z1], [x2, z2]] },
            { main: line.main, description: row['Notes'] },
        ))
    }

    // Portals, each with its connector to the highway stored as a LineString.
    const portals: LayerObject[] = []
    for (const row of read('map.tsv')) {
        const x = parseInt(row['X']), z = parseInt(row['Z'])
        if (!row['Name'] || isNaN(x) || isNaN(z)) {
            problems.push(`map.tsv: skipped "${row['Name']}", which has no name or position`)
            continue
        }
        const point: Geometry = { type: 'Point', coordinates: [x, z] }
        const end = connectorEnd(lines, row, x, z)
        const geometry: Geometry = end && (end[0] !== x || end[1] !== z)
            ? { type: 'GeometryCollection', geometries: [point, { type: 'LineString', coordinates: [[x, z], end] }] }
            : point
        portals.push(makeObject(geometry, {
            name: row['Name'],
            entity: row['Political Entity'] ? nation(row['Political Entity']).id : undefined,
            line: lineObjects.get(row['Inner Line'])?.id,
            description: row['Description'],
            wiki: row['Wiki URL'],
            national: row['National'] === '1',
            end: row['End'] === '1',
            ibwh: row['IBWH'] === '1',
            warning: row['Warning'],
            hidden: row['Hide'] === '1',
        }))
    }

    // Validate, dropping properties the Sheet got wrong (like a bad URL)
    // rather than failing the whole import.
    function write(dir: string, objects: LayerObject[], isOurs: (o: LayerObject) => boolean) {
        const layer = Layer.parse(JSON.parse(fs.readFileSync(path.join(dir, 'layer.json'), 'utf8')))
        const schema = objectSchema(layer)
        for (const object of objects) {
            const result = schema.safeParse(object)
            if (result.success) continue
            for (const issue of result.error.issues) {
                const [where, key] = issue.path
                if (where !== 'properties' || typeof key !== 'string') throw new Error(`${object.properties.name}: ${z.prettifyError(result.error)}`)
                problems.push(`${object.properties.name}: dropped ${key} "${object.properties[key]}" (${issue.message})`)
                delete object.properties[key]
            }
        }
        for (const old of existingObjects(dir)) if (isOurs(old)) fs.rmSync(path.join(dir, old.id + '.json'))
        for (const object of objects) fs.writeFileSync(path.join(dir, object.id + '.json'), formatJson(object))
    }

    write(netherDir, [...lineObjects.values(), ...portals], () => true)
    write(politicalDir, [...nations.values()], o => o.geometry === null)

    for (const problem of problems) console.warn(problem)
    console.log(`Imported ${portals.length} portals, ${lines.length} lines, and ${nations.size} nations`)
}

if (import.meta.main) {
    const [dataDir = 'data', layersDir = 'layers'] = process.argv.slice(2)
    importSheets(dataDir, layersDir)
}
