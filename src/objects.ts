// Looks up objects across every layer and follows the references between them,
// e.g. from a portal to its nation, or from a nation back to its polygons.

import { valuesOf, type Field, type Geometry, type LayerObject, type Position } from '../shared/layer.ts'
import type { MapObject } from './layers.ts'

export class ObjectIndex {
    readonly all: MapObject[]
    private byId = new Map<string, MapObject>()
    private referencedBy = new Map<MapObject, MapObject[]>()

    constructor(all: MapObject[]) {
        this.all = all
        for (const o of all) this.byId.set(o.object.id, o)
        for (const o of all) {
            for (const target of this.references(o)) {
                this.referencedBy.set(target, [...this.referencedBy.get(target) ?? [], o])
            }
        }
    }

    get(id: string): MapObject | undefined {
        return this.byId.get(id)
    }

    // The objects this one points to, through its reference and entities fields.
    references(o: MapObject): MapObject[] {
        return o.layer.fields.flatMap(f => this.resolve(o, f))
    }

    // The objects one of this object's fields points to.
    resolve(o: MapObject, field: Field): MapObject[] {
        const value = o.object.properties[field.key]
        const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
        if (field.type !== 'reference' && field.type !== 'entities') return []
        return values.flatMap(v => this.byId.get(v) ?? [])
    }

    // The objects that point to this one.
    referencers(o: MapObject): MapObject[] {
        return this.referencedBy.get(o) ?? []
    }

    // An object's title field (a polygon's directory name), or else the titles
    // of what it references, so an unnamed polygon is titled with its nation's
    // name. Lines and other untitled objects get ''.
    title(o: MapObject): string {
        return ownTitle(o) || this.referencedTitles(o)
    }

    // The name drawn on the map: an object's label field if set, or else the
    // titles of what it references (a polygon's entities), or else its title.
    label(o: MapObject): string {
        return ownLabel(o) || this.referencedTitles(o) || ownTitle(o)
    }

    private referencedTitles(o: MapObject): string {
        return this.references(o).map(ownTitle).filter(Boolean).join(' / ')
    }

    // An object's color fields, or else the colors of what it references, or
    // else its layer's default color. So a community layer's area is its own
    // Color, and a political area its nations' colors unless it has a Color of
    // its own, which overrides them. A polygon claimed by several nations gets
    // several colors.
    colors(o: MapObject): string[] {
        const colorsOf = (m: MapObject) => valuesOf(m.layer, m.object, 'color')
        const own = colorsOf(o)
        if (own.length) return own
        const referenced = this.references(o).flatMap(colorsOf)
        if (referenced.length) return referenced
        return o.layer.defaultColor ? [o.layer.defaultColor] : []
    }
}

const ownTitle = (o: MapObject) => (o.object.properties[o.layer.titleField] as string | undefined) ?? ''
const ownLabel = (o: MapObject) => (o.layer.labelField && o.object.properties[o.layer.labelField] as string | undefined) || ''

// The block position of an object's point, if it has one.
export function position(object: LayerObject): Position | null {
    const find = (g: Geometry | null): Position | null => {
        if (g?.type === 'Point') return g.coordinates
        if (g?.type === 'GeometryCollection') return g.geometries.map(find).find(Boolean) ?? null
        return null
    }
    return find(object.geometry)
}
