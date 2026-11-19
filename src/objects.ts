// Looks up objects across every layer and follows the references between them,
// e.g. from a portal to its nation, or from a nation back to its polygons.

import { entityName, valuesOf, type Field, type Geometry, type LayerObject, type Position } from '../shared/layer.ts'
import type { MapObject } from './layers.ts'

export class ObjectIndex {
    readonly all: MapObject[]
    private byId = new Map<string, MapObject>()
    private byEntityName = new Map<string, MapObject>()
    private referencedBy = new Map<MapObject, MapObject[]>()

    constructor(all: MapObject[]) {
        this.all = all
        for (const o of all) {
            this.byId.set(o.object.id, o)
            const name = entityName(o.layer, o.object)
            if (name) this.byEntityName.set(name, o)
        }
        for (const o of all) {
            for (const target of this.references(o)) {
                this.referencedBy.set(target, [...this.referencedBy.get(target) ?? [], o])
            }
        }
    }

    // The objects this one points to: by ID through its reference fields, and
    // by name through its entities fields.
    references(o: MapObject): MapObject[] {
        return o.layer.fields.flatMap(f => this.resolve(o, f))
    }

    // The objects one of this object's fields points to.
    resolve(o: MapObject, field: Field): MapObject[] {
        const value = o.object.properties[field.key]
        const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
        const lookup = field.type === 'reference' ? this.byId : field.type === 'entities' ? this.byEntityName : null
        return lookup ? values.flatMap(v => lookup.get(v) ?? []) : []
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

    // An object's color fields, or else the colors of what it references. A
    // polygon claimed by several nations gets several colors.
    colors(o: MapObject): string[] {
        const colorsOf = (m: MapObject) => valuesOf(m.layer, m.object, 'color')
        const own = colorsOf(o)
        return own.length ? own : this.references(o).flatMap(colorsOf)
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
