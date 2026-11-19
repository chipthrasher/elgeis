// Creates the Leaflet map, the political background image, and the coordinate
// readout.

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DIMENSION_SCALE } from '../shared/layer.ts'
import { el } from './dom.ts'

// Leaflet's Simple CRS puts north (negative z) up when lat = -z.
export const toLatLng = (x: number, z: number) => L.latLng(-z, x)

// Distance from (0, 0) to the world border in the Overworld.
const MAP_SIZE = 5500

export function createMap(): L.Map {
    const map = L.map('layers', {
        crs: L.CRS.Simple,
        zoom: -3,
        minZoom: -4,
        maxZoom: 0,
        maxBounds: [[-3 * MAP_SIZE, -3 * MAP_SIZE], [3 * MAP_SIZE, 3 * MAP_SIZE]],
        center: [0, 0],
    })

    L.imageOverlay('political.jpg', [[-MAP_SIZE, -MAP_SIZE], [MAP_SIZE, MAP_SIZE]], { className: 'political-image', pane: 'tilePane' }).addTo(map)

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

    return map
}
