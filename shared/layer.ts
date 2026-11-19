// Types and validation for layers and the objects in them. Shared by the build
// scripts, the browser, and (later) the backend, so they all agree on what
// valid layer data is.

import { z } from 'zod'

// --- IDs ---------------------------------------------------------------------

// Every object ID is a type prefix plus random characters, e.g. `pol_8f3k2a9x`.
// IDs are permanent and never derived from names.
// The prefixes are for points, lines, polygons, entities, and layers.
export type IdPrefix = 'pnt' | 'lin' | 'pol' | 'ent' | 'lay'

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 8

export function newId(prefix: IdPrefix): string {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
    // 256 isn't a multiple of 36, so this is very slightly biased. That's fine
    // for IDs, which only need to be unique.
    return prefix + '_' + Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

const objectId = z.string().regex(/^(pnt|lin|pol|ent)_[0-9a-z]+$/, 'Expected an object ID like "pol_8f3k2a9x"')

// Official layers have readable IDs ("nether"); community layers get `lay_` IDs.
export const LayerId = z.string().regex(/^([a-z]+|lay_[0-9a-z]+)$/, 'Expected a layer ID like "nether" or "lay_3k9x2m7q"')

// --- Layer manifests -----------------------------------------------------------

export const DIMENSIONS = ['overworld', 'nether'] as const
export type Dimension = typeof DIMENSIONS[number]

// Nether coordinates are drawn this many times larger, so people can enter the
// Nether block positions they see in game.
export const DIMENSION_SCALE: Record<Dimension, number> = { overworld: 1, nether: 8 }

// The fixed icon set that flag and text fields can show.
export const ICONS = ['flag', 'aperture', 'book', 'alert'] as const
export type Icon = typeof ICONS[number]

export const FIELD_TYPES = ['text', 'url', 'color', 'flag', 'reference'] as const
export type FieldType = typeof FIELD_TYPES[number]

const fieldKey = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'Expected a camelCase field key')

export const Field = z.object({
    key: fieldKey,
    label: z.string().min(1),
    type: z.enum(FIELD_TYPES),
    // Shown as the icon's tooltip, e.g. what a flag means.
    description: z.string().min(1).optional(),
    icon: z.enum(ICONS).optional(),
    // Points with this flag set are drawn with a ring, e.g. national exits.
    ring: z.boolean().optional(),
}).strict()
    .refine(f => !f.icon || f.type === 'flag' || f.type === 'text', 'Only flag and text fields can have an icon')
    .refine(f => !f.ring || f.type === 'flag', 'Only flag fields can have a ring')
export type Field = z.infer<typeof Field>

export const Layer = z.object({
    id: LayerId,
    name: z.string().min(1),
    dimension: z.enum(DIMENSIONS),
    // Official layers show by default.
    official: z.boolean().optional(),
    titleField: fieldKey,
    fields: z.array(Field),
}).strict().superRefine((layer, ctx) => {
    const keys = layer.fields.map(f => f.key)
    for (const key of new Set(keys.filter((k, i) => keys.indexOf(k) !== i)))
        ctx.addIssue({ code: 'custom', path: ['fields'], message: `Duplicate field "${key}"` })
    if (keys.includes('hidden'))
        ctx.addIssue({ code: 'custom', path: ['fields'], message: '"hidden" is built in and can\'t be a field' })
    const title = layer.fields.find(f => f.key === layer.titleField)
    if (title?.type !== 'text')
        ctx.addIssue({ code: 'custom', path: ['titleField'], message: `Title field "${layer.titleField}" must be a text field` })
})
export type Layer = z.infer<typeof Layer>

// --- Geometry ------------------------------------------------------------------

// Coordinates are integer Minecraft block positions, [x, z].
const Position = z.tuple([z.number().int(), z.number().int()])
export type Position = z.infer<typeof Position>

const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]
const Ring = z.array(Position).min(4)
    .refine(ring => samePosition(ring[0], ring[ring.length - 1]), 'A polygon ring must end where it starts')

const Point = z.object({ type: z.literal('Point'), coordinates: Position }).strict()
const LineString = z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }).strict()
// The first ring is the outline; any others are holes.
const Polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1) }).strict()
const MultiPolygon = z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1)).min(1) }).strict()
const SimpleGeometry = z.discriminatedUnion('type', [Point, LineString, Polygon, MultiPolygon])
// Lets one object carry stored derived geometry, e.g. a Nether portal's Point
// plus the LineString connecting it to the highway.
const GeometryCollection = z.object({
    type: z.literal('GeometryCollection'),
    geometries: z.array(SimpleGeometry).min(1),
}).strict()

export const Geometry = z.discriminatedUnion('type', [Point, LineString, Polygon, MultiPolygon, GeometryCollection])
export type Geometry = z.infer<typeof Geometry>

// The ID prefix for a new object with this geometry. Entities have none.
export function idPrefixFor(geometry: Geometry | null): IdPrefix {
    switch (geometry?.type) {
        case undefined: return 'ent'
        case 'Point': return 'pnt'
        case 'LineString': return 'lin'
        case 'Polygon':
        case 'MultiPolygon': return 'pol'
        case 'GeometryCollection': return idPrefixFor(geometry.geometries[0])
    }
}

// --- Objects -------------------------------------------------------------------

const FIELD_VALUES: Record<FieldType, z.ZodType> = {
    text: z.string().min(1),
    url: z.url({ protocol: /^https?$/ }),
    color: z.string().regex(/^#([0-9a-f]{3}){1,2}$/i, 'Expected a color like "#ff3f3f"'),
    flag: z.boolean(),
    reference: z.union([objectId, z.array(objectId).min(1)]),
}

export type PropertyValue = string | boolean | string[]

// An object is a GeoJSON Feature. Entities (like nations) have no geometry.
export interface LayerObject {
    type: 'Feature'
    id: string
    geometry: Geometry | null
    properties: Record<string, PropertyValue>
}

// Build the validator for objects in a layer, from the layer's schema.
export function objectSchema(layer: Layer): z.ZodType<LayerObject> {
    const properties: Record<string, z.ZodType> = { hidden: z.boolean().optional() }
    for (const field of layer.fields) properties[field.key] = FIELD_VALUES[field.type].optional()

    return z.object({
        type: z.literal('Feature'),
        id: objectId,
        geometry: Geometry.nullable(),
        properties: z.object(properties).strict(),
    }).strict().refine(
        o => (idPrefixFor(o.geometry) === 'ent') === o.id.startsWith('ent_'),
        { message: 'Entities (ent_ IDs) have no geometry, and every other object has some', path: ['id'] },
    ) as z.ZodType<LayerObject>
}

// The IDs an object references through its reference fields.
export function referencedIds(layer: Layer, object: LayerObject): string[] {
    return layer.fields
        .filter(f => f.type === 'reference')
        .flatMap(f => object.properties[f.key] ?? [])
        .filter((v): v is string => typeof v === 'string')
}
