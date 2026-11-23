// The layers control: the layers being viewed, each with a checkbox, listed in
// the order they're stacked, top first. Drag a layer by its handle (or move it
// with the arrow keys) to draw it above or below the others. Official layers
// are always listed; community layers once they're turned on from "See more",
// above the list. The dynmap image is always at the bottom.
//
// What's shown is kept in ?layers=, in the same order, top first, so views
// can be shared. It's left out when the view is the default. Which community
// layers are listed, shown or not, is kept in this browser's local storage.

import L from 'leaflet'
import { el, mobile } from './dom.ts'
import { stackLayers } from './layers.ts'
import { getParam, setParam } from './url.ts'

export interface Toggle {
    id: string
    name: string
    group: L.Layer
    // Official layers: always listed, and shown when there's no ?layers=.
    byDefault: boolean
    // Whether it has panes of its own to stack. The dynmap image doesn't.
    stacks: boolean
}

export type LayerControl = ReturnType<typeof createLayerControl>

// `more` opens what "See more" shows: the layers that aren't listed by default.
export function createLayerControl(map: L.Map, toggles: Toggle[], more: () => void) {
    const byId = (id: string) => toggles.find(t => t.id === id)
    const defaults = toggles.filter(t => t.stacks && t.byDefault)
    // What can't be stacked is listed below the rest, in a fixed order.
    const fixed = toggles.filter(t => !t.stacks)

    // The listed layers that stack, top first: those in ?layers=, in its
    // order, then the community layers listed here before, then any other
    // official layers.
    const param = getParam('layers')?.split(',')
    const stacking = (ids: string[]) => ids.flatMap(id => byId(id)?.stacks ? [byId(id)!] : [])
    let order = [...new Set([...stacking(param ?? []), ...stacking(loadListed()), ...defaults])]
    for (const t of toggles) if (param ? param.includes(t.id) : t.byDefault) t.group.addTo(map)

    const listed = (t: Toggle) => order.includes(t) || fixed.includes(t)
    const shownIds = (view: Toggle[]) => view.filter(t => map.hasLayer(t.group)).map(t => t.id)

    function save() {
        storeListed(order)
        const shown = shownIds([...order, ...fixed])
        const isDefault = shown.join() === [...defaults, ...fixed.filter(t => t.byDefault)].map(t => t.id).join()
        setParam('layers', isDefault ? null : shown.join(','))
    }

    const restack = () => stackLayers(map, order.map(t => t.id).reverse())

    function reorder(next: Toggle[]) {
        order = next
        restack()
        save()
    }

    /* The list */

    const moreButton = el('button', { type: 'button', class: 'see-more' }, 'See more')
    moreButton.addEventListener('click', more)
    const rows = el('div')
    // On phones it starts collapsed to Leaflet's layers icon, and collapses
    // again when the map is tapped.
    const toggle = el('a', { class: 'leaflet-control-layers-toggle', href: '#', title: 'Layers', role: 'button' })
    const container = el('div', { class: 'leaflet-control-layers layer-control' }, [
        toggle,
        el('div', { class: 'leaflet-control-layers-list' }, [moreButton, rows]),
    ])
    const expand = (on: boolean) => container.classList.toggle('leaflet-control-layers-expanded', on)
    expand(!mobile.matches)
    toggle.addEventListener('click', e => { e.preventDefault(); expand(true) })
    map.on('click', () => { if (mobile.matches) expand(false) })

    function render() {
        rows.replaceChildren(...order.map(t => row(t, true)), ...fixed.map(t => row(t, false)))
    }

    function row(t: Toggle, movable: boolean) {
        const box = el('input', { type: 'checkbox', checked: map.hasLayer(t.group) })
        box.addEventListener('change', () => { if (box.checked) t.group.addTo(map); else t.group.remove() })
        const handle = movable && el('button', { type: 'button', class: 'handle', title: 'Drag to draw it above or below other layers', 'aria-label': `Move ${t.name} up or down` }, '⠿')
        const node = el('div', { class: movable ? 'layer-row movable' : 'layer-row', 'data-id': t.id }, [
            handle || el('span', { class: 'handle' }),
            el('label', {}, [box, ' ', t.name]),
        ])
        if (handle) draggable(handle, node, t)
        return node
    }

    const movableRows = () => [...rows.querySelectorAll<HTMLElement>('.layer-row.movable')]
    const orderOfRows = () => movableRows().map(r => byId(r.dataset.id!)!)

    function draggable(handle: HTMLElement, node: HTMLElement, t: Toggle) {
        // Follow the pointer, moving the row past those whose middle it passes.
        // Listens on the whole page, since moving the row would lose a
        // pointer capture on the handle.
        handle.addEventListener('pointerdown', e => {
            e.preventDefault()
            node.classList.add('dragging')
            const move = (e: PointerEvent) => {
                const others = movableRows().filter(r => r !== node)
                const before = others.find(r => {
                    const box = r.getBoundingClientRect()
                    return e.clientY < box.top + box.height / 2
                })
                if (before) before.before(node)
                else others.at(-1)?.after(node)
            }
            const drop = () => {
                document.removeEventListener('pointermove', move)
                document.removeEventListener('pointerup', drop)
                document.removeEventListener('pointercancel', drop)
                node.classList.remove('dragging')
                reorder(orderOfRows())
            }
            document.addEventListener('pointermove', move)
            document.addEventListener('pointerup', drop)
            document.addEventListener('pointercancel', drop)
        })

        // Or move it a step with the arrow keys.
        handle.addEventListener('keydown', e => {
            const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
            const i = order.indexOf(t)
            if (!step || i + step < 0 || i + step >= order.length) return
            e.preventDefault()
            const next = [...order]
            next.splice(i, 1)
            next.splice(i + step, 0, t)
            reorder(next)
            render()
            rows.querySelector<HTMLElement>(`[data-id="${t.id}"] .handle`)?.focus()
        })
    }

    // Keep the checkboxes right however layers are shown or hidden (like the
    // change request view hiding them all), and tell the rest of the map, the
    // way Leaflet's own control does.
    map.on('layeradd layerremove', e => {
        const t = toggles.find(t => t.group === e.layer)
        if (!t || !listed(t)) return
        for (const box of container.querySelectorAll<HTMLInputElement>(`[data-id="${t.id}"] input`)) box.checked = map.hasLayer(t.group)
        map.fire(e.type === 'layeradd' ? 'overlayadd' : 'overlayremove', { layer: t.group, name: t.name })
        save()
    })

    render()
    restack()
    // Layers in a shared link are listed here from now on.
    storeListed(order)
    const Control = L.Control.extend({
        onAdd: () => {
            L.DomEvent.disableClickPropagation(container)
            L.DomEvent.disableScrollPropagation(container)
            return container
        },
    })
    new Control({ position: 'bottomleft' }).addTo(map)

    return {
        // Whether a layer is in the list, shown or not.
        isListed(id: string) {
            const t = byId(id)
            return t !== undefined && listed(t)
        },
        // Know about a layer made since the page loaded.
        add(t: Toggle) {
            toggles.push(t)
        },
        // Show a community layer and list it, on top; or hide it and unlist it.
        setShown(id: string, on: boolean) {
            const t = byId(id)
            if (!t) return
            if (on) {
                if (!order.includes(t)) order = [t, ...order]
                render()
                restack()
                t.group.addTo(map)
            } else {
                t.group.remove()
                reorder(order.filter(o => o !== t))
                render()
            }
        },
    }
}

// The community layers listed in the layers control, top first. Storage can be
// unavailable, like in a private window, and then nothing is remembered.
const LISTED_KEY = 'listedLayers'

function loadListed(): string[] {
    try {
        const ids: unknown = JSON.parse(localStorage.getItem(LISTED_KEY) ?? '[]')
        return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

function storeListed(order: Toggle[]) {
    try {
        localStorage.setItem(LISTED_KEY, JSON.stringify(order.filter(t => !t.byDefault).map(t => t.id)))
    } catch {
        // Not remembered.
    }
}
