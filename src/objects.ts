// Looks up objects across every layer and follows the references between them,
// e.g. from a portal to its nation, or from a nation back to its polygons.

import { referencedIds, type Geometry, type LayerObject, type Position } from '../shared/layer.ts'
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

    // The objects this one points to through its reference fields.
    references(o: MapObject): MapObject[] {
        return referencedIds(o.layer, o.object).flatMap(id => this.byId.get(id) ?? [])
    }

    // The objects that point to this one.
    referencers(o: MapObject): MapObject[] {
        return this.referencedBy.get(o) ?? []
    }

    // An object's title field, or else the titles of what it references, so a
    // nation's polygon is titled with the nation's name. Lines and other
    // untitled objects get ''.
    title(o: MapObject): string {
        return ownTitle(o) || this.references(o).map(ownTitle).filter(Boolean).join(' / ')
    }

    // An object's color fields, or else the colors of what it references. A
    // polygon claimed by several nations gets several colors.
    colors(o: MapObject): string[] {
        const own = valuesOfType(o, 'color')
        return own.length ? own : this.references(o).flatMap(r => valuesOfType(r, 'color'))
    }
}

const ownTitle = (o: MapObject) => (o.object.properties[o.layer.titleField] as string | undefined) ?? ''

function valuesOfType(o: MapObject, type: string): string[] {
    return o.layer.fields
        .filter(f => f.type === type)
        .map(f => o.object.properties[f.key])
        .filter((v): v is string => typeof v === 'string')
}

// The block position of an object's point, if it has one.
export function position(object: LayerObject): Position | null {
    const find = (g: Geometry | null): Position | null => {
        if (g?.type === 'Point') return g.coordinates
        if (g?.type === 'GeometryCollection') return g.geometries.map(find).find(Boolean) ?? null
        return null
    }
    return find(object.geometry)
}
