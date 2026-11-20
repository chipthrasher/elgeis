// Creates the Leaflet map, the dynmap background image, and the coordinate
// readout.

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DIMENSION_SCALE } from '../shared/layer.ts'
import { el } from './dom.ts'

// Leaflet's Simple CRS puts north (negative z) up when lat = -z.
export const toLatLng = (x: number, z: number) => L.latLng(-z, x)

// Distance from (0, 0) to the world border in the Overworld.
const MAP_SIZE = 5500

export function createMap(): { map: L.Map, dynmap: L.ImageOverlay } {
    const map = L.map('layers', {
        crs: L.CRS.Simple,
        zoom: -3,
        minZoom: -4,
        maxZoom: 0,
        maxBounds: [[-3 * MAP_SIZE, -3 * MAP_SIZE], [3 * MAP_SIZE, 3 * MAP_SIZE]],
        center: [0, 0],
        attributionControl: false,
    })

    // A render of the world from the server's dynmap, drawn beneath every layer.
    // main.ts decides whether it shows.
    const dynmap = L.imageOverlay('dynmap.jpg', [[-MAP_SIZE, -MAP_SIZE], [MAP_SIZE, MAP_SIZE]], { className: 'dynmap', pane: 'tilePane' })

    // Coordinate readout (top-left), updated as the mouse moves.
    const readout = L.DomUtil.create('div', 'map-box leaflet-control-coordinates')
    const Coords = L.Control.extend({ onAdd: () => readout })
    new Coords({ position: 'topleft' }).addTo(map)
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
        const x = Math.round(e.latlng.lng), z = Math.round(-e.latlng.lat)
        const scale = DIMENSION_SCALE.nether
        readout.replaceChildren(
            el('strong', {}, 'Overworld:'), el('div', { class: 'mono' }, `${x}, ${z}`),
            el('strong', {}, 'Nether:'), el('div', { class: 'mono' }, `${Math.floor(x / scale)}, ${Math.floor(z / scale)}`),
        )
    })

    // Today's date in Elgeis (bottom-right), linking to the date converter.
    const date = el('a', { class: 'map-box', href: 'https://chipthrasher.com/elgeis/' }, elgeisDate(new Date()))
    const Today = L.Control.extend({ onAdd: () => date })
    new Today({ position: 'bottomright' }).addTo(map)

    return { map, dynmap }
}

// Elgeis began on September 1, 2018 (Day 1 of Year 1), and each year starts on
// September 1. Months and days are the same as ours, e.g. "November 20, Year 9".
function elgeisDate(day: Date) {
    const SEPTEMBER = 8
    const year = day.getFullYear() - 2018 + (day.getMonth() >= SEPTEMBER ? 1 : 0)
    return `${day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, Year ${year}`
}
