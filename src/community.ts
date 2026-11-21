// Community layers: every layer that isn't official. They're hidden until a
// viewer finds and turns them on from "See more" in the layers control, which adds them
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
    // The layers control, once it's made.
    control: () => LayerControl
    layers: MapLayer[]
    show: Show
    // Called with a layer made here, before it's shown.
    created: (mapLayer: MapLayer) => void
    // Opens a layer's settings, for its admins.
    settings: (layerId: string) => void
}

export function createCommunity({ control, layers, show, created, settings }: Options) {
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

    // "See more" in the layers control: a window listing every community
    // layer, to search and add to or remove from the layers control, with its admins and description,
    // and a gear to open the settings of those you're an admin of.
    async function browse() {
        const dialog = el('dialog', { class: 'panel browse', 'aria-label': 'Community layers' })
        const close = () => dialog.close()
        // Who runs each layer, from the backend. Left out if it can't be reached.
        const infos = await api<LayerInfo[]>('layers').catch(() => [])
        const infoOf = (layerId: string) => infos.find(i => i.id === layerId)
        const list = layers.filter(l => !l.layer.official)
            .sort((a, b) => a.layer.name.localeCompare(b.layer.name))
            .map(l => {
                const admins = infoOf(l.layer.id)?.admins ?? []
                // Ticked while it's in the layers control, even if it's unticked there.
                const box = el('input', { type: 'checkbox', checked: control().isListed(l.layer.id) })
                box.addEventListener('change', () => control().setShown(l.layer.id, box.checked))
                const gear = infoOf(l.layer.id)?.canAdmin && el('button', { type: 'button', class: 'link gear', title: 'Layer settings', 'aria-label': `Settings for ${l.layer.name}` }, '⚙')
                if (gear) gear.addEventListener('click', () => { close(); settings(l.layer.id) })
                const node = el('div', { class: 'browse-row' }, [
                    el('label', {}, [
                        box,
                        el('span', { class: 'browse-text' }, [
                            el('span', { class: 'browse-head' }, [
                                el('span', { class: 'browse-name' }, l.layer.name),
                                admins.length > 0 && el('span', { class: 'admins' }, `${admins.length === 1 ? 'Admin' : 'Admins'}: ${admins.join(', ')}`),
                            ]),
                            l.layer.description && el('small', {}, l.layer.description),
                        ]),
                    ]),
                    gear,
                ])
                return { node, text: [l.layer.name, l.layer.description, ...admins].join('\n').toLowerCase() }
            })

        const search = el('input', { type: 'search', placeholder: 'Search by name, description, or admin' })
        const none = el('p', { class: 'muted' }, list.length ? 'No layers match.' : 'No community layers yet.')
        const filter = () => {
            const query = search.value.trim().toLowerCase()
            for (const { node, text } of list) node.hidden = !text.includes(query)
            none.hidden = list.some(({ node }) => !node.hidden)
        }
        search.addEventListener('input', filter)

        dialog.append(
            el('div', { class: 'panel-head' }, [el('h2', {}, 'Community layers'), button('×', close, 'link close')]),
            el('p', { class: 'muted' }, 'Maps people have made of their own. Turn them on to add them to the map.'),
            search,
            el('div', { class: 'browse-list' }, [...list.map(l => l.node), none]),
            el('div', { class: 'row' }, button('Make a new layer', () => { close(); openNew() }, 'link')),
        )
        // Clicks outside the window land on the dialog itself, behind it.
        dialog.addEventListener('click', e => { if (e.target === dialog) close() })
        dialog.addEventListener('close', () => dialog.remove())
        filter()
        document.body.append(dialog)
        dialog.showModal()
        search.focus()
    }

    return { openNew, browse }
}
