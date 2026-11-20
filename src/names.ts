// Names for objects, so people see "Emeraldia" rather than "ent_0068pnvf".
// Entities and references are stored by ID; the editor shows them by name and
// turns the names people type back into IDs. An ID only shows when a name is
// missing or shared, e.g. "Goomlandia (pol_8f3k2a9x)".

import { valuesOf, type Field, type Layer, type LayerData, type LayerObject, type PropertyValue } from '../shared/layer.ts'
import type { ObjectIndex } from './objects.ts'

const ID_IN_PARENS = /\(([a-z]+_[0-9a-z]+)\)$/

export class Names {
    private objects = new Map<string, { layer: Layer, object: LayerObject }>()

    constructor(index: ObjectIndex) {
        for (const o of index.all) this.objects.set(o.object.id, o)
    }

    // Include a layer loaded in full, with its hidden objects.
    add({ layer, objects }: LayerData) {
        for (const object of objects) this.objects.set(object.id, { layer, object })
    }

    // An object's name: its title, or else its entities' names, or else ''.
    describe(layer: Layer, object: LayerObject): string {
        const title = object.properties[layer.titleField]
        if (typeof title === 'string' && title) return title
        return valuesOf(layer, object, 'entities').map(id => this.name(id)).join(' / ')
    }

    // The name of an object by ID, or its ID if it has none.
    name(id: string): string {
        const o = this.objects.get(id)
        return (o && this.describe(o.layer, o.object)) || id
    }

    // What a field can point to: entities for an entities field, anything for
    // a reference.
    private candidates(field: Field): string[] {
        const ids = [...this.objects.keys()]
        return field.type === 'entities' ? ids.filter(id => id.startsWith('ent_')) : ids
    }

    // How one value shows in a field, and in its suggestions.
    private tokens(field: Field): Map<string, string> {
        const ids = this.candidates(field)
        const count = new Map<string, number>()
        for (const id of ids) count.set(this.name(id), (count.get(this.name(id)) ?? 0) + 1)
        return new Map(ids.map(id => {
            const name = this.name(id)
            return [id, name === id || count.get(name) === 1 ? name : `${name} (${id})`]
        }))
    }

    // The suggestions for a field, sorted by name.
    options(field: Field): string[] {
        return [...this.tokens(field).values()].sort((a, b) => a.localeCompare(b))
    }

    format(field: Field, value: PropertyValue | undefined): string {
        const ids = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
        const tokens = this.tokens(field)
        return ids.map(id => tokens.get(id) ?? id).join(', ')
    }

    // The IDs for what's typed, comma-separated. Throws if a name matches
    // nothing, or several things.
    parse(field: Field, text: string): string[] {
        const tokens = this.tokens(field)
        return text.split(',').map(s => s.trim()).filter(Boolean).map(typed => {
            const inParens = typed.match(ID_IN_PARENS)?.[1]
            if (inParens && tokens.has(inParens)) return inParens
            if (tokens.has(typed)) return typed
            const matches = [...tokens.keys()].filter(id => this.name(id).toLowerCase() === typed.toLowerCase())
            if (matches.length === 1) return matches[0]
            throw new Error(matches.length
                ? `${field.label}: Several things are called "${typed}"; pick one from the list`
                : `${field.label}: Nothing is called "${typed}"`)
        })
    }
}
