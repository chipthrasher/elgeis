// Creates the Leaflet map, the dynmap background image, and the coordinate
// readout. Where the map is looking is kept in the URL (?x=&z=&zoom=, the
// block at the middle of the screen and the zoom level), so views can be
// shared.

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DIMENSION_SCALE } from '../shared/layer.ts'
import { el, mobile } from './dom.ts'
import { getParam, setParam } from './url.ts'

// Leaflet's Simple CRS puts north (negative z) up when lat = -z.
export const toLatLng = (x: number, z: number) => L.latLng(-z, x)

// Distance from (0, 0) to the world border in the Overworld.
const MAP_SIZE = 5500

// Where the map looks when there's nothing in the URL.
const HOME = { x: 0, z: 0, zoom: -3 }
const MIN_ZOOM = -4, MAX_ZOOM = 2

// The view in the URL, or the home view for whatever's missing or nonsense.
function viewFromUrl() {
    const read = (name: 'x' | 'z' | 'zoom', min: number, max: number) => {
        const value = Number(getParam(name) ?? NaN)
        return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : HOME[name]
    }
    const edge = 3 * MAP_SIZE
    return { x: read('x', -edge, edge), z: read('z', -edge, edge), zoom: read('zoom', MIN_ZOOM, MAX_ZOOM) }
}

export function createMap(): { map: L.Map, dynmap: L.ImageOverlay } {
    const view = viewFromUrl()
    const map = L.map('layers', {
        crs: L.CRS.Simple,
        zoom: view.zoom,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxBounds: [[-3 * MAP_SIZE, -3 * MAP_SIZE], [3 * MAP_SIZE, 3 * MAP_SIZE]],
        center: toLatLng(view.x, view.z),
        attributionControl: false,
        // Lets the editor draw on it (see draw.ts).
        pmIgnore: false,
    })

    // A render of the world from the server's dynmap, drawn beneath every layer.
    // main.ts decides whether it shows.
    const dynmap = L.imageOverlay('dynmap.jpg', [[-MAP_SIZE, -MAP_SIZE], [MAP_SIZE, MAP_SIZE]], { className: 'dynmap', pane: 'tilePane' })

    // Coordinate readout (top-left), updated as the mouse moves. Phones have
    // no mouse, so there it shows the block under a crosshair in the middle.
    const readout = L.DomUtil.create('div', 'map-box leaflet-control-coordinates')
    const Coords = L.Control.extend({ onAdd: () => readout })
    new Coords({ position: 'topleft' }).addTo(map)
    map.getContainer().append(el('div', { class: 'crosshair' }))
    function showCoords(latlng: L.LatLng) {
        const x = Math.round(latlng.lng), z = Math.round(-latlng.lat)
        const scale = DIMENSION_SCALE.nether
        readout.replaceChildren(
            el('strong', {}, 'Overworld:'), el('div', { class: 'mono' }, `${x}, ${z}`),
            el('strong', {}, 'Nether:'), el('div', { class: 'mono' }, `${Math.floor(x / scale)}, ${Math.floor(z / scale)}`),
        )
    }
    const showCenter = () => { if (mobile.matches) showCoords(map.getCenter()) }
    map.on('mousemove', (e: L.LeafletMouseEvent) => { if (!mobile.matches) showCoords(e.latlng) })
    map.on('move resize', showCenter)
    showCenter()

    // Keep the view in the URL whenever it settles, leaving out the home view.
    // Also tidies up a URL whose view was nonsense or out of bounds.
    function saveView() {
        const center = map.getCenter()
        const x = Math.round(center.lng), z = Math.round(-center.lat), zoom = map.getZoom()
        const home = x === HOME.x && z === HOME.z && zoom === HOME.zoom
        setParam('x', home ? null : String(x))
        setParam('z', home ? null : String(z))
        setParam('zoom', home ? null : String(zoom))
    }
    map.on('moveend', saveView)
    saveView()

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
