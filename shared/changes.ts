// Change requests: what they are, and how their operations apply to a layer.
// Shared by the backend, which checks and applies them, and the browser, which
// builds them and shows them to reviewers, so the two always agree.

import { z } from 'zod'
import { formatJson } from './format.ts'
import { checkLayers, ObjectId, objectSchema, type Layer, type LayerData, type LayerObject } from './layer.ts'

export const MAX_OPEN_REQUESTS = 10

export const STATUSES = ['draft', 'submitted', 'stale', 'approved', 'rejected', 'withdrawn'] as const
export type Status = typeof STATUSES[number]
// Open requests count toward the limit, and can still be edited or withdrawn.
export const OPEN_STATUSES: readonly Status[] = ['draft', 'submitted', 'stale']

// A version of an object, recorded with each update or delete, so a request
// can tell when its object has changed since. It hashes the object's formatted
// JSON (cyrb53, a fast non-cryptographic hash), so the backend and the browser
// work it out the same way.
export function objectVersion(object: LayerObject): string {
    const text = formatJson(object)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 2654435761)
        h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const Version = z.string().min(1)

export type Op =
    | { op: 'add', object: LayerObject }
    | { op: 'update', baseVersion: string, object: LayerObject }
    | { op: 'delete', id: string, baseVersion: string }

// Objects are checked against their layer's schema separately (see checkOps),
// since that depends on the layer.
export const Op = z.discriminatedUnion('op', [
    z.object({ op: z.literal('add'), object: z.looseObject({ id: ObjectId }) }).strict(),
    z.object({ op: z.literal('update'), baseVersion: Version, object: z.looseObject({ id: ObjectId }) }).strict(),
    z.object({ op: z.literal('delete'), id: ObjectId, baseVersion: Version }).strict(),
]) as unknown as z.ZodType<Op>

export const RequestBody = z.object({
    // The title becomes the first line of the approval's commit message.
    title: z.string().trim().max(200).regex(/^[^\p{Cc}]*$/u, 'A title has to be one line, without special characters'),
    ops: z.array(Op).max(500),
}).strict()

export const opId = (op: Op) => op.op === 'delete' ? op.id : op.object.id

export interface CheckResult {
    // Every layer, with the ops applied.
    layers: LayerData[]
    // What's wrong with the ops, as messages for their author.
    errors: string[]
    // The objects the ops change that have changed since (or are gone), which
    // makes the request stale.
    stale: string[]
}

// Apply a request's ops to its layer, checking each op and the result.
export function checkOps(layers: LayerData[], layerId: string, ops: Op[]): CheckResult {
    const errors: string[] = []
    const stale: string[] = []
    const target = layers.find(l => l.layer.id === layerId)
    if (!target) return { layers, errors: [`No layer "${layerId}"`], stale }
    if (ops.length === 0) errors.push('Nothing to change yet')

    const schema = objectSchema(target.layer)
    const objects = new Map(target.objects.map(o => [o.id, o]))
    const allIds = new Set(layers.flatMap(l => l.objects.map(o => o.id)))
    const seen = new Set<string>()

    for (const op of ops) {
        const id = opId(op)
        if (seen.has(id)) errors.push(`${id}: Changed twice in one request`)
        seen.add(id)

        if (op.op === 'add') {
            if (allIds.has(id)) errors.push(`${id}: Already exists`)
        } else {
            const current = objects.get(id)
            if (!current || objectVersion(current) !== op.baseVersion) stale.push(id)
        }

        if (op.op === 'delete') {
            objects.delete(id)
            continue
        }
        const result = schema.safeParse(op.object)
        if (!result.success) {
            errors.push(`${id}: ${z.prettifyError(result.error).replaceAll('\n', ' ')}`)
            continue
        }
        objects.set(id, result.data)
    }
    for (const id of stale) errors.push(`${id}: Changed since this request was made`)

    const changed: LayerData = { layer: target.layer, objects: [...objects.values()] }
    const applied = layers.map(l => l === target ? changed : l)
    // The layers were valid before, so any problem is one the ops made.
    for (const p of checkLayers(applied)) errors.push(`${p.objectId}: ${p.message}`)
    return { layers: applied, errors, stale }
}

// The properties an update changes, for reviewers.
export function changedFields(layer: Layer, before: LayerObject, after: LayerObject) {
    const keys = ['hidden', ...layer.fields.map(f => f.key)]
    const label = (key: string) => layer.fields.find(f => f.key === key)?.label ?? 'Hidden'
    return keys
        .filter(k => JSON.stringify(before.properties[k]) !== JSON.stringify(after.properties[k]))
        .map(k => ({ key: k, label: label(k), before: before.properties[k], after: after.properties[k] }))
}

// A stale update merged with what's changed since it was made, field by field
// (the shape counts as one field, `geometry`). A field changed on only one
// side takes that side's value; one changed differently on both is a
// conflict, which keeps yours until the author picks. Without the object as it
// was when the request was made (`base`), every difference is a conflict.
export interface Merge {
    merged: LayerObject
    // Fields where the newer value was kept, since the request didn't change them.
    kept: string[]
    // Fields both changed, differently.
    conflicts: string[]
}

export function mergeChanges(base: LayerObject | null, theirs: LayerObject, mine: LayerObject): Merge {
    const get = (o: LayerObject, key: string) => key === 'geometry' ? o.geometry : o.properties[key]
    const same = (a: unknown, b: unknown) => formatJson(a ?? null) === formatJson(b ?? null)
    const keys = new Set(['geometry', ...[base, theirs, mine].flatMap(o => o ? Object.keys(o.properties) : [])])
    const merged: LayerObject = { ...mine, properties: {} }
    const kept: string[] = []
    const conflicts: string[] = []
    for (const key of keys) {
        const t = get(theirs, key), m = get(mine, key)
        let value = m
        if (!same(t, m)) {
            if (base && same(get(base, key), m)) {
                value = t
                kept.push(key)
            } else if (!base || !same(get(base, key), t)) {
                conflicts.push(key)
            }
        }
        if (key === 'geometry') merged.geometry = (value ?? null) as LayerObject['geometry']
        else if (value !== undefined) merged.properties[key] = value as LayerObject['properties'][string]
    }
    return { merged, kept, conflicts }
}
