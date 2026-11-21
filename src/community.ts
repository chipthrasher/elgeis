// Community layers: every layer that isn't official. They're hidden until a
// viewer turns them on under "See more" in the layers control, which adds them
// to the top of its list (and so to ?layers=). Anyone signed in can make a new
// one with "New layer", and becomes its admin.

import L from 'leaflet'
import { DIMENSIONS, type Layer } from '../shared/layer.ts'
import { api } from './api.ts'
import { attempt, button, el, errorBox } from './dom.ts'
import type { LayerInfo } from './layer-admin.ts'
import type { LayerControl } from './layer-control.ts'
import type { MapLayer } from './layers.ts'

type Show = (title: string, ...children: (Node | string | null | false)[]) => void

interface Options {
    map: L.Map
    // The layers control, once it's made.
    control: () => LayerControl
    layers: MapLayer[]
    show: Show
    // Called with a layer made here, before it's shown.
    created: (mapLayer: MapLayer) => void
}

export function createCommunity({ map, control, layers, show, created }: Options) {
    // The form for making a layer.
    function openNew() {
        const name = el('input', { required: true, placeholder: 'Name' })
        const description = el('input', { placeholder: 'What it shows (optional)' })
        const dimension = el('select', {}, DIMENSIONS.map(d => el('option', { value: d }, d === 'overworld' ? 'Overworld' : 'Nether')))
        const error = errorBox()
        const form = el('form', {}, [
            el('label', { class: 'field' }, [el('span', {}, 'Name'), name]),
            el('label', { class: 'field' }, [el('span', {}, 'Description'), description]),
            el('label', {}, ['Coordinates from the ', dimension]),
            error,
            el('div', { class: 'row' }, el('button', { class: 'primary' }, 'Make the layer')),
        ])
        form.addEventListener('submit', e => {
            e.preventDefault()
            attempt(error, async () => {
                const layer = await api<Layer>('layers', { name: name.value, description: description.value, dimension: dimension.value })
                const l: MapLayer = { layer, objects: [], group: L.layerGroup() }
                layers.push(l)
                created(l)
                control().setShown(layer.id, true)
            })
        })
        show('New layer',
            el('p', { class: 'muted' }, "Make a map of your own. Once it's made, anyone can suggest things to add to it, but only layer admins can approve them."),
            form,
        )
    }

    // What "See more" in the layers control lists: each community layer, to
    // turn on or off, with its admins on the right.
    async function seeMore(): Promise<Node[]> {
        const list = layers.filter(l => !l.layer.official)
        // Who runs each layer, from the backend. Left out if it can't be reached.
        const infos = await api<LayerInfo[]>('layers').catch(() => [])
        const adminsOf = (layerId: string) => infos.find(i => i.id === layerId)?.admins ?? []
        return [
            ...list.length ? list.map(l => {
                const box = el('input', { type: 'checkbox', checked: map.hasLayer(l.group) })
                box.addEventListener('change', () => control().setShown(l.layer.id, box.checked))
                const admins = adminsOf(l.layer.id)
                return el('label', { class: 'more-row', 'data-id': l.layer.id, title: l.layer.description ?? '' }, [
                    box,
                    el('span', {}, l.layer.name),
                    admins.length > 0 && el('span', { class: 'admins' }, admins.join(', ')),
                ])
            }) : [el('div', { class: 'muted' }, 'No community layers yet.')],
            button('Make a new layer', openNew, 'see-more'),
        ]
    }

    return { openNew, seeMore }
}
