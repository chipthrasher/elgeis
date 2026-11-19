// Loads the built layer JSON and draws each object with Leaflet. Nothing here
// knows about any particular layer: points, lines, and polygons are drawn the
// same way everywhere, and Nether layers are scaled up to Overworld size.

import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import { DIMENSION_SCALE, type Layer, type LayerObject } from '../shared/layer.ts'
import { toLatLng } from './map.ts'

export interface MapObject {
    object: LayerObject
    layer: Layer
    // What's drawn on the map; null for entities, which have no geometry.
    drawn: L.GeoJSON | null
}

export interface MapLayer {
    layer: Layer
    objects: MapObject[]
    group: L.LayerGroup
}

const BASE = 'dist/layers/'

async function fetchJson(path: string) {
    const response = await fetch(path)
    if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
    return response.json()
}

// Every layer is loaded, even hidden ones, so references between layers (like
// a portal's nation) always resolve.
export async function loadLayers(): Promise<MapLayer[]> {
    const index: Layer[] = await fetchJson(BASE + 'index.json')
    return Promise.all(index.map(async layer => {
        const { features }: { features: LayerObject[] } = await fetchJson(`${BASE}${layer.id}.json`)
        const group = L.layerGroup()
        const objects = features.map(object => ({
            object,
            layer,
            drawn: object.geometry ? draw(layer, object).addTo(group) : null,
        }))
        return { layer, objects, group }
    }))
}

// For polygons whose nation has no color yet.
const NO_COLOR = '#888'

// Polygons get their own pane so they always sit below lines and points, no
// matter which layer is toggled on last.
export function addPanes(map: L.Map) {
    map.createPane('polygons').style.zIndex = '350'
}

// Leaflet only draws paths within the renderer's bounds (the view plus
// `padding` on each side, as a fraction of the view) and redraws when a drag
// ends. With the default 0.1, dragging reveals a blank gap until then.
const PADDING = 1
const polygonRenderer = L.svg({ pane: 'polygons', padding: PADDING })
const lineRenderer = L.svg({ padding: PADDING })

function draw(layer: Layer, object: LayerObject): L.GeoJSON {
    const scale = DIMENSION_SCALE[layer.dimension]
    const ring = layer.fields.some(f => f.ring && object.properties[f.key] === true)

    return L.geoJSON(object as GeoJsonObject, {
        coordsToLatLng: ([x, z]) => toLatLng(x * scale, z * scale),
        pointToLayer: (_, latlng) => L.marker(latlng, {
            icon: L.divIcon({ className: ring ? 'point ring' : 'point', iconSize: [10, 10] }),
        }),
        style: feature => {
            const polygon = /Polygon/.test(feature?.geometry.type ?? '')
            return polygon
                ? { className: 'polygon', pane: 'polygons', renderer: polygonRenderer, color: NO_COLOR, fillColor: NO_COLOR }
                : { className: 'line', renderer: lineRenderer, interactive: false }
        },
        // Tag each element with its object's ID, e.g. `[data-id="pol_8f3k2a9x"]`.
        // Leaflet makes new elements whenever a layer is re-added, so tag on every add.
        onEachFeature: (_, drawn) => drawn.on('add', () => {
            (drawn as L.Path | L.Marker).getElement?.()?.setAttribute('data-id', object.id)
        }),
    })
}

// Fill polygons with their colors (their own, or their nation's). A polygon
// with several colors, like one claimed by several nations, is hatched in all
// of them.
export function colorPolygons(objects: MapObject[], colorsOf: (o: MapObject) => string[]) {
    const patterns = new Map<string, string>()
    const defs = document.createElementNS(SVG_NS, 'defs')

    for (const o of objects) {
        if (!o.drawn || !/Polygon/.test(o.object.geometry?.type ?? '')) continue
        const colors = colorsOf(o)
        if (colors.length === 0) continue
        if (colors.length === 1) {
            o.drawn.setStyle({ color: colors[0], fillColor: colors[0] })
            continue
        }
        const key = colors.join(',')
        if (!patterns.has(key)) {
            const id = `hatch-${patterns.size}`
            patterns.set(key, id)
            defs.append(hatch(id, colors))
        }
        o.drawn.setStyle({ color: colors[0], fillColor: `url(#${patterns.get(key)})` })
    }

    // Patterns can be referenced from any SVG on the page, including Leaflet's.
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'patterns')
    svg.append(defs)
    document.body.append(svg)
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const STRIPE = 8 // px

// Diagonal stripes, one per color.
function hatch(id: string, colors: string[]): SVGPatternElement {
    const pattern = document.createElementNS(SVG_NS, 'pattern')
    const attrs = { id, patternUnits: 'userSpaceOnUse', width: String(STRIPE * colors.length), height: '1', patternTransform: 'rotate(45)' }
    for (const [k, v] of Object.entries(attrs)) pattern.setAttribute(k, v)
    colors.forEach((color, i) => {
        const rect = document.createElementNS(SVG_NS, 'rect')
        const rectAttrs = { x: String(i * STRIPE), y: '0', width: String(STRIPE), height: '1', fill: color }
        for (const [k, v] of Object.entries(rectAttrs)) rect.setAttribute(k, v)
        pattern.append(rect)
    })
    return pattern
}
