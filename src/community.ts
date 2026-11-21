// Community layers: every layer that isn't official. They're hidden until a
// viewer turns them on in this list, which adds them to the top of the layers
// control (and so to ?layers=). Anyone signed in can make a new one here, and becomes
// its admin.

import L from 'leaflet'
import { DIMENSIONS, type Layer } from '../shared/layer.ts'
import { api } from './api.ts'
import { attempt, el, errorBox } from './dom.ts'
import type { LayerInfo } from './layer-admin.ts'
import type { LayerControl } from './layer-control.ts'
import type { MapLayer } from './layers.ts'

type Show = (title: string, ...children: (Node | string | null | false)[]) => void

interface Options {
    map: L.Map
    control: LayerControl
    layers: MapLayer[]
    show: Show
    // Called with a layer made here, before it's shown.
    created: (mapLayer: MapLayer) => void
}

export function createCommunity({ map, control, layers, show, created }: Options) {
    const community = () => layers.filter(l => !l.layer.official)

    async function open() {
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
                control.setShown(layer.id, true)
            })
        })

        const list = community()
        // Who runs each layer, from the backend. Left out if it can't be reached.
        const infos = await api<LayerInfo[]>('layers').catch(() => [])
        const adminsOf = (layerId: string) => infos.find(i => i.id === layerId)?.admins ?? []
        show('Your layers',
            el('p', { class: 'muted' }, 'Maps people have made of their own. Turn them on to see them.'),
            list.length === 0 && el('p', { class: 'muted' }, 'There are none yet.'),
            ...list.map(l => {
                const box = el('input', { type: 'checkbox', checked: map.hasLayer(l.group) })
                box.addEventListener('change', () => control.setShown(l.layer.id, box.checked))
                const admins = adminsOf(l.layer.id)
                return el('label', { class: 'check community' }, [
                    el('span', { class: 'community-head' }, [
                        box,
                        el('span', {}, l.layer.name),
                        admins.length > 0 && el('span', { class: 'admins' }, `${admins.length === 1 ? 'Admin' : 'Admins'}: ${admins.join(', ')}`),
                    ]),
                    l.layer.description && el('small', { class: 'help' }, l.layer.description),
                ])
            }),
            el('h3', {}, 'Make your own'),
            el('p', { class: 'muted' }, "Once it's made, anyone can suggest things to add to it, and you decide what goes on."),
            form,
        )
    }

    return { open }
}
