// Drawing and editing one object's shape on the map, with Leaflet-Geoman:
// points, lines, and polygons with holes and several parts. New vertices snap
// to the vertices of what's already drawn, so neighboring borders line up.
// While drawing a line or area, Backspace or Ctrl+Z (Cmd+Z) takes back the
// last corner.

import L from 'leaflet'
import type { LineString, MultiLineString, MultiPolygon, Polygon as GeoPolygon } from 'geojson'
import './leaflet-global.ts'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import { contains } from '../shared/geometry.ts'
import type { Geometry, Position } from '../shared/layer.ts'
import { toLatLng } from './map.ts'

export type ShapeKind = 'Point' | 'LineString' | 'Polygon'
type Editable = L.Marker | L.Polyline<LineString | MultiLineString | GeoPolygon | MultiPolygon>

// Only what's opted in is editable or snapped to: the drawn objects (see
// layers.ts) and the shape being edited, not labels or the dynmap image.
L.PM.setOptIn(true)

const SNAPPING = { snappable: true, snapDistance: 12, snapSegment: false, snapVertex: true }
const STYLE: L.PathOptions = { className: 'editing', pane: 'overlayPane' }

export interface ShapeEditor {
    // The shape as drawn so far, or null if nothing's drawn yet.
    geometry(): Geometry | null
    // Draw a polygon to cut out of the one being edited, or to add as another part.
    addRing(as: 'hole' | 'part'): void
    stop(): void
}

export function editShape(map: L.Map, kind: ShapeKind, initial: Geometry | null, scale: number, onChange: () => void): ShapeEditor {
    const toPos = (ll: L.LatLng): Position => [Math.round(ll.lng / scale), Math.round(-ll.lat / scale)]
    const toLL = ([x, z]: Position) => toLatLng(x * scale, z * scale)
    // Leaflet rings aren't closed; GeoJSON's are.
    const openRing = (ring: Position[]) => ring.slice(0, -1).map(toLL)

    let shape: Editable | null = null

    function edit(layer: Editable) {
        shape = layer
        layer.addTo(map)
        layer.pm.enable({ ...SNAPPING, removeLayerBelowMinVertexCount: false })
        layer.on('pm:edit pm:markerdragend pm:vertexadded pm:vertexremoved', onChange)
        onChange()
    }

    // Stops Backspace and Ctrl+Z from taking back corners.
    let stopUndo = () => {}

    function draw(drawKind: ShapeKind, done: (layer: L.Layer) => void) {
        const shapeName = drawKind === 'Point' ? 'Marker' : drawKind === 'LineString' ? 'Line' : 'Polygon'
        const start = () => map.pm.enableDraw(shapeName, {
            ...SNAPPING,
            continueDrawing: false,
            pathOptions: STYLE,
            markerStyle: { icon: pointIcon },
        })
        start()

        // Take back the last corner. Geoman cancels the drawing when it takes
        // back the only one, so start afresh instead.
        const undo = (e: KeyboardEvent) => {
            const key = e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z')
            const typing = (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')
            const handler = (map.pm.Draw as unknown as Record<string, { enabled(): boolean, _markers?: unknown[], _removeLastVertex?(): void }>)[shapeName]
            if (!key || typing || !handler?.enabled() || !handler._markers?.length) return
            e.preventDefault()
            if (handler._markers.length > 1) {
                handler._removeLastVertex!()
            } else {
                map.pm.disableDraw()
                start()
            }
        }
        stopUndo()
        document.addEventListener('keydown', undo)
        stopUndo = () => document.removeEventListener('keydown', undo)
        map.once('pm:create', e => {
            stopUndo()
            done(e.layer)
        })
    }

    const pointIcon = L.divIcon({ className: 'point editing', iconSize: [12, 12] })
    const options = { ...STYLE, pmIgnore: false }
    switch (initial?.type) {
        case 'Point':
            edit(L.marker(toLL(initial.coordinates), { icon: pointIcon, pmIgnore: false }))
            break
        case 'LineString':
            edit(L.polyline(initial.coordinates.map(toLL), options))
            break
        case 'Polygon':
            edit(L.polygon(initial.coordinates.map(openRing), options))
            break
        case 'MultiPolygon':
            edit(L.polygon(initial.coordinates.map(p => p.map(openRing)), options))
            break
        default:
            draw(kind, layer => {
                map.removeLayer(layer)
                const created = layer as Editable
                created.options.pmIgnore = false
                L.PM.reInitLayer(created)
                edit(created)
            })
    }

    // The polygon's parts, each an outline and its holes, as positions.
    function parts(polygon: L.Polygon): Position[][][] {
        const latLngs = polygon.getLatLngs() as L.LatLng[][] | L.LatLng[][][]
        const nested = (latLngs[0]?.[0] instanceof L.LatLng ? [latLngs] : latLngs) as L.LatLng[][][]
        return nested.map(rings => rings.map(ring => {
            const positions = ring.map(toPos).filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1])
            return [...positions, positions[0]]
        }).filter(ring => ring.length >= 4)).filter(rings => rings.length)
    }

    return {
        geometry() {
            if (shape instanceof L.Marker) return { type: 'Point', coordinates: toPos(shape.getLatLng()) }
            if (shape instanceof L.Polygon) {
                const p = parts(shape)
                if (p.length === 0) return null
                return p.length === 1 ? { type: 'Polygon', coordinates: p[0] } : { type: 'MultiPolygon', coordinates: p }
            }
            if (shape instanceof L.Polyline) {
                const coordinates = (shape.getLatLngs() as L.LatLng[]).map(toPos)
                return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null
            }
            return null
        },

        addRing(as) {
            if (!(shape instanceof L.Polygon)) return
            const polygon = shape
            draw('Polygon', layer => {
                map.removeLayer(layer)
                const ring = parts(layer as L.Polygon)[0]?.[0]
                if (!ring) return
                const current = parts(polygon)
                if (as === 'part') current.push([ring])
                else current.find(([outline]) => contains(outline, ring[0]))?.push(ring)
                polygon.pm.disable()
                polygon.setLatLngs(current.map(p => p.map(openRing)))
                polygon.pm.enable({ ...SNAPPING, removeLayerBelowMinVertexCount: false })
                onChange()
            })
        },

        stop() {
            stopUndo()
            map.pm.disableDraw()
            map.off('pm:create')
            if (shape) {
                shape.pm.disable()
                map.removeLayer(shape)
            }
        },
    }
}
