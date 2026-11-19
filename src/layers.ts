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

// Polygons get their own pane so they always sit below lines and points, no
// matter which layer is toggled on last.
export function addPanes(map: L.Map) {
    map.createPane('polygons').style.zIndex = '350'
}

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
                ? { className: 'polygon', pane: 'polygons' }
                : { className: 'line', interactive: false }
        },
    })
}
