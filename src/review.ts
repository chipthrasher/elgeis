// Shows a change request: each change on the map (the old shape in red, the
// new one in green) with its changed properties, warnings about borders that
// overlap or leave gaps, and comments. Reviewers approve or reject it here,
// and authors follow it.

import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import { changedFields, objectVersion, OPEN_STATUSES, opId, type Op } from '../shared/changes.ts'
import { borderWarnings, polygonParts } from '../shared/geometry.ts'
import { DIMENSION_SCALE, valuesOf, type Field, type Layer, type LayerObject, type PropertyValue } from '../shared/layer.ts'
import type { ChangeRequest, FullLayer } from './api.ts'
import { el } from './dom.ts'
import { toLatLng } from './map.ts'
import type { Names } from './names.ts'

const VERBS = { add: 'Add', update: 'Change', delete: 'Delete' }

export function describeOp(names: Names, data: FullLayer, op: Op): string {
    const object = op.op === 'delete' ? data.objects.find(o => o.id === op.id) : op.object
    return `${VERBS[op.op]} ${(object && names.describe(data.layer, object)) || opId(op)}`
}

// The IDs of the objects a request changes that have changed since.
export const staleIds = (data: FullLayer, ops: Op[]) => ops.filter(op => {
    if (op.op === 'add') return false
    const current = data.objects.find(o => o.id === opId(op))
    return !current || objectVersion(current) !== op.baseVersion
}).map(opId)

// A property's value as text, with entities and references by name.
function show(names: Names, field: Field | undefined, value: PropertyValue | undefined): string {
    if (value === undefined) return '—'
    if (field?.type === 'entities' || field?.type === 'reference') return names.format(field, value)
    return value === true ? 'Yes' : String(value)
}

// Polygons claimed by several entities are disputed, and can overlap.
const disputed = (layer: Layer, o: LayerObject) => valuesOf(layer, o, 'entities').length > 1

// Draw the request's changes on the map, and list them. Returns a function
// that removes what it drew.
export function showChanges(map: L.Map, names: Names, data: FullLayer, request: ChangeRequest, list: HTMLElement): () => void {
    const { layer } = data
    const field = (key: string) => layer.fields.find(f => f.key === key)
    const scale = DIMENSION_SCALE[layer.dimension]
    const group = L.featureGroup().addTo(map)
    const draw = (object: LayerObject | undefined, className: string) => {
        if (!object?.geometry) return
        L.geoJSON(object as GeoJsonObject, {
            coordsToLatLng: ([x, z]) => toLatLng(x * scale, z * scale),
            pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 6 }),
            style: { className, interactive: false },
        }).addTo(group)
    }

    // The layer as it would be, for checking borders.
    const after = new Map(data.objects.map(o => [o.id, o]))
    for (const op of request.ops) {
        if (op.op === 'delete') after.delete(op.id)
        else after.set(op.object.id, op.object)
    }
    const neighbors = [...after.values()]
        .filter(o => polygonParts(o.geometry).length && !o.properties.hidden && !disputed(layer, o))
        .map(o => ({ id: o.id, parts: polygonParts(o.geometry) }))

    // Once approved, what's there now is what the request made.
    const done = !OPEN_STATUSES.includes(request.status)
    for (const op of request.ops) {
        const before = done ? undefined : data.objects.find(o => o.id === opId(op))
        const next = op.op === 'delete' ? undefined : op.object
        draw(before, 'diff-old')
        draw(next, 'diff-new')

        const rows = op.op === 'delete' ? [] : changedFields(layer, before ?? { ...op.object, properties: {} }, op.object)
        const geometryChanged = JSON.stringify(before?.geometry ?? null) !== JSON.stringify(next?.geometry ?? null)
        const item = el('div', { class: 'change' }, [
            el('div', { class: `change-title ${op.op}` }, describeOp(names, data, op)),
            rows.length > 0 && el('table', {}, rows.map(r => el('tr', {}, [
                el('th', {}, r.label),
                before && el('td', { class: 'old' }, show(names, field(r.key), r.before)),
                el('td', { class: 'new' }, show(names, field(r.key), r.after)),
            ]))),
            op.op !== 'delete' && geometryChanged && before && el('div', { class: 'muted' }, 'Shape changed'),
        ])

        // Borders: overlaps and gaps with the polygon's neighbors.
        if (next && polygonParts(next.geometry).length && !next.properties.hidden && !disputed(layer, next)) {
            const others = neighbors.filter(n => n.id !== next.id)
            for (const w of borderWarnings(polygonParts(next.geometry), others)) {
                const neighbor = after.get(w.with)
                const name = (neighbor && names.describe(layer, neighbor)) || w.with
                item.append(el('div', { class: 'warning' }, `${w.kind === 'overlap' ? 'Overlaps' : 'Leaves a gap with'} ${name} near ${w.at.map(Math.round).join(', ')}`))
                L.circleMarker(toLatLng(w.at[0] * scale, w.at[1] * scale), { radius: 10, className: 'diff-warning', interactive: false }).addTo(group)
            }
        }
        list.append(item)
    }

    const bounds = group.getBounds()
    if (bounds.isValid()) map.flyToBounds(bounds, { maxZoom: -1, padding: [80, 80], duration: 0.5 })
    return () => group.remove()
}
