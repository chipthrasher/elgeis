// The directory, search, hover cards, and highlighting, all generated from each
// layer's schema. Nothing here knows about any particular layer.

import L from 'leaflet'
import tippy from 'tippy.js'
import type { Field } from '../shared/layer.ts'
import { el, safeUrl, svgFromMarkup } from './dom.ts'
import { ICON_MARKUP } from './icons.ts'
import type { MapLayer, MapObject } from './layers.ts'
import { position, type ObjectIndex } from './objects.ts'
import { getParam, setParam } from './url.ts'

const PAN_SECONDS = 0.2

// Every Leaflet path or marker element an object is drawn with.
function elements(layer: L.Layer): Element[] {
    if (layer instanceof L.LayerGroup) return layer.getLayers().flatMap(elements)
    const element = (layer as L.Path | L.Marker).getElement?.()
    return element ? [element] : []
}
const elementsOf = (o: MapObject) => o.drawn ? elements(o.drawn) : []

// One solid color, or for a contested object, a band of each color side by side.
function swatch(colors: string[]): string {
    if (colors.length === 1) return colors[0]
    const bands = colors.map((c, i) => `${c} ${i / colors.length * 100}% ${(i + 1) / colors.length * 100}%`)
    return `linear-gradient(to right, ${bands.join(', ')})`
}

export function createSidebar(map: L.Map, layers: MapLayer[], index: ObjectIndex) {
    const searchInput = document.querySelector<HTMLInputElement>('.search')!
    const directory = document.querySelector('#directory')!
    const items = new Map<MapObject, HTMLDetailsElement>()

    // Objects with a title and something on the map are listed and searchable.
    // The rest (like highway lines) always show. The index can include layers
    // that aren't shown here, so only list objects from these layers.
    const shown = new Set(layers.map(l => l.layer))
    const listed = index.all.filter(o => shown.has(o.layer) && o.drawn && index.title(o))

    /* Highlighting: an object, plus everything it references or is referenced by */

    function highlight(o: MapObject, on: boolean) {
        // Including what shares a reference, like the other polygons of a nation.
        const references = index.references(o)
        const related = [o, ...references, ...index.referencers(o), ...references.flatMap(r => index.referencers(r))]
        for (const r of related) {
            for (const element of elementsOf(r)) element.classList.toggle('highlight', on)
        }
        items.get(o)?.querySelector('summary')?.classList.toggle('hover', on)
    }

    /* Directory entries */

    // Show a field's value. Fields with icons are collected into one row instead.
    function fieldValue(o: MapObject, field: Field): Node | null {
        const value = o.object.properties[field.key]
        switch (field.type) {
            case 'text':
                return el('div', { class: 'text' }, value as string)
            case 'url': {
                const href = safeUrl(value as string)
                return href ? el('div', {}, el('a', { class: 'link', href }, field.label)) : null
            }
            case 'flag':
                return value ? el('div', { class: 'text' }, field.label) : null
            case 'reference':
            case 'entities': {
                // Each referenced title links to a search for it.
                const titles = index.resolve(o, field).map(r => index.title(r)).filter(Boolean)
                return titles.length ? el('div', { class: 'reference' }, titles.map(t => el('span', { 'data-search': t }, t))) : null
            }
            case 'color':
                return null // shown as the entry's swatch
        }
    }

    function icon(o: MapObject, field: Field): Node | null {
        const value = o.object.properties[field.key]
        if (!field.icon || !value) return null
        const tooltip = typeof value === 'string' ? value : field.description ?? field.label
        const span = el('span', { class: `icon icon-${field.icon}` }, svgFromMarkup(ICON_MARKUP[field.icon]))
        tippy(span, { content: tooltip })
        return span
    }

    function buildItem(o: MapObject): HTMLDetailsElement {
        const pos = position(o.object)
        // The title is the entry's heading, and the label is only for the map.
        const fields = o.layer.fields.filter(f => f.key !== o.layer.titleField && f.key !== o.layer.labelField && o.object.properties[f.key] !== undefined)
        const colors = index.colors(o)

        return el('details', { class: 'item' }, [
            el('summary', {}, [
                el('div', { class: 'itemleft' }, index.title(o)),
                el('div', { class: 'itemright', style: colors.length ? `background: ${swatch(colors)}` : undefined }, ' '),
            ]),
            el('div', { class: 'itemcontent' }, [
                pos && el('div', { class: 'coords' }, `${pos[0]}, ${pos[1]}`),
                ...fields.filter(f => !f.icon).map(f => fieldValue(o, f)),
                el('div', { class: 'icons' }, fields.map(f => icon(o, f))),
            ]),
        ])
    }

    function hoverCard(o: MapObject): HTMLElement {
        const pos = position(o.object)
        return el('div', {}, [
            el('div', { class: 'name' }, index.title(o)),
            pos && el('div', { class: 'coords' }, `${pos[0]}, ${pos[1]}`),
        ])
    }

    // Pan to an object if it's entirely off-screen.
    function reveal(o: MapObject) {
        const bounds = o.drawn?.getBounds()
        if (bounds?.isValid() && !map.getBounds().intersects(bounds)) {
            map.panTo(bounds.getCenter(), { duration: PAN_SECONDS, animate: true })
        }
    }

    const sections = new Map<MapLayer, HTMLElement>()
    for (const mapLayer of layers) {
        const entries = listed
            .filter(o => o.layer === mapLayer.layer)
            .sort((a, b) => index.title(a).localeCompare(index.title(b)))
        if (entries.length === 0) continue

        const section = el('section', {}, el('h2', {}, mapLayer.layer.name))
        for (const o of entries) {
            const item = buildItem(o)
            items.set(o, item)
            section.append(item)

            const summary = item.querySelector('summary')!
            summary.addEventListener('click', () => reveal(o))
            summary.addEventListener('mouseenter', () => { highlight(o, true); o.drawn?.openTooltip() })
            summary.addEventListener('mouseleave', () => { highlight(o, false); o.drawn?.closeTooltip() })

            // Polygons have their names drawn inside them instead (see labels.ts).
            if (!/Polygon/.test(o.object.geometry?.type ?? '')) {
                o.drawn!.bindTooltip(hoverCard(o), { direction: 'right', offset: [8, 0] })
            }
            o.drawn!.on('mouseover', () => highlight(o, true))
            o.drawn!.on('mouseout', () => highlight(o, false))
            o.drawn!.on('click', () => select(o))
        }
        sections.set(mapLayer, section)
        directory.append(section)
    }

    // Only list the layers being viewed that have entries matching the search.
    function showSections() {
        for (const [mapLayer, section] of sections) {
            const empty = !section.querySelector('.item:not(.hidden)')
            section.classList.toggle('hidden', empty || !map.hasLayer(mapLayer.group))
        }
    }
    map.on('overlayadd overlayremove', () => {
        // Leaflet redraws a layer's elements when it's re-added, which drops
        // their classes, so search again.
        lastQuery = null
        search()
    })

    /* Search: text fields, referenced titles, and coordinates */

    function haystack(o: MapObject): string {
        const values = o.layer.fields
            .filter(f => f.type === 'text' || f.type === 'url')
            .map(f => o.object.properties[f.key])
        const pos = position(o.object)
        return [index.title(o), ...values, ...index.references(o).map(r => index.title(r)), pos?.join(', ')]
            .filter(Boolean).join('\n').toLowerCase()
    }
    const haystacks = new Map(listed.map(o => [o, haystack(o)]))

    let lastQuery: string | null = null
    function search() {
        if (searchInput.value === lastQuery) return
        lastQuery = searchInput.value
        setParam('q', searchInput.value)

        const query = searchInput.value.toLowerCase()
        const matched = new Set(listed.filter(o => haystacks.get(o)!.includes(query)))
        // Also show what matches reference, like a portal's inner line.
        for (const o of [...matched]) for (const r of index.references(o)) matched.add(r)

        for (const o of listed) {
            const show = matched.has(o)
            for (const element of elementsOf(o)) element.classList.toggle('unmatched', !show)
            const item = items.get(o)!
            item.classList.toggle('hidden', !show)
            item.open = false
        }
        showSections()
    }

    function setSearch(value: string) {
        searchInput.value = value
        search()
    }

    // Clicking an object searches for it (or clears the search if it already
    // was), and opens its entry.
    function select(o: MapObject) {
        const title = index.title(o)
        setSearch(searchInput.value === title ? '' : title)
        const item = items.get(o)!
        item.open = !!searchInput.value
        if (item.open) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    searchInput.addEventListener('input', search)
    document.querySelector('.clear')!.addEventListener('click', () => setSearch(''))
    directory.addEventListener('click', e => {
        const value = (e.target as Element).closest('[data-search]')?.getAttribute('data-search')
        if (value) setSearch(value)
    })

    tippy.setDefaultProps({ animation: 'fade', duration: 100, arrow: false, placement: 'right' })

    // Old links double-encoded the search.
    let q = getParam('q') ?? ''
    try { q = decodeURIComponent(q) } catch { /* already decoded */ }
    setSearch(q)
}
