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
        maxZoom: 2,
        maxBounds: [[-3 * MAP_SIZE, -3 * MAP_SIZE], [3 * MAP_SIZE, 3 * MAP_SIZE]],
        center: [0, 0],
        attributionControl: false,
        // Lets the editor draw on it (see draw.ts).
        pmIgnore: false,
    })

    // A render of the world from the server's dynmap, drawn beneath every layer.
    // main.ts decides whether it shows.
    const dynmap = L.imageOverlay('dynmap.jpg', [[-MAP_SIZE, -MAP_SIZE], [MAP_SIZE, MAP_SIZE]], { className: 'dynmap', pane: 'tilePane' })

    // Coordinate readout (top-left), updated as the mouse moves.
    const readout = L.DomUtil.create('div', 'leaflet-control-coordinates')
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

    return { map, dynmap }
}
