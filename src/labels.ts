// Names drawn inside polygons. Each name sits at the point deepest inside its
// polygon, or just above or below it if a point is in the way. Names that
// would overlap are hidden, with roomier polygons getting first pick, so small
// polygons get their names when nothing's in the way.

import L from 'leaflet'
import polylabel from 'polylabel'
import { DIMENSION_SCALE, type Position } from '../shared/layer.ts'
import { el } from './dom.ts'
import { paneFor, type MapObject } from './layers.ts'
import { toLatLng } from './map.ts'

interface Label {
    span: HTMLElement
    latLng: L.LatLng
    // Radius of the largest circle inside the polygon, used as priority.
    room: number
}

// Returns a function that stops refitting them; they're removed with their objects.
export function addLabels(map: L.Map, objects: MapObject[], labelOf: (o: MapObject) => string) {
    const labels: Label[] = []

    for (const o of objects) {
        const geometry = o.object.geometry
        const title = labelOf(o)
        if (!o.drawn || !title || (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon')) continue

        // For a MultiPolygon, label the part with the most room.
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        const pole = polygons.map(p => polylabel(p as Position[][], 1)).reduce((a, b) => b.distance > a.distance ? b : a)
        const scale = DIMENSION_SCALE[o.layer.dimension]

        const span = el('span', {}, title)
        // Added to the object's own group, so it shares the object's toggling,
        // hover card, highlighting, and search classes.
        const latLng = toLatLng(pole[0] * scale, pole[1] * scale)
        o.drawn.addLayer(L.marker(latLng, {
            icon: L.divIcon({ className: 'polygon-label', html: span }),
            interactive: false,
            keyboard: false,
            // Above its layer's polygons and lines, below its points.
            pane: paneFor(o.layer.id, 'labels'),
        }))
        labels.push({ span, latLng, room: pole.distance * scale })
    }

    labels.sort((a, b) => b.room - a.room)

    // Space kept between names, in pixels.
    const GAP = 4

    function fit() {
        // Points, like portals, can be drawn over names, so a name that would
        // be covered by one moves a line up or down if there's room.
        const container = map.getContainer()
        const origin = container.getBoundingClientRect()
        const points = [...container.querySelectorAll('.leaflet-marker-icon.point')]
            .map(e => e.getBoundingClientRect())
            .filter(r => r.width)
            .map(r => L.bounds([r.left - origin.left, r.top - origin.top], [r.right - origin.left, r.bottom - origin.top]))

        const placed: L.Bounds[] = []
        for (const { span, latLng } of labels) {
            // Labels in hidden layers aren't in the page and measure 0.
            const size = L.point(span.offsetWidth + GAP, span.offsetHeight + GAP)
            if (size.x === GAP) continue
            const center = map.latLngToContainerPoint(latLng)
            const spots = [0, -size.y, size.y].map(dy => {
                const middle = center.add([0, dy])
                return { dy, box: L.bounds(middle.subtract(size.divideBy(2)), middle.add(size.divideBy(2))) }
            })
            const free = (box: L.Bounds) => !placed.some(b => b.overlaps(box))
            const spot = spots.find(s => free(s.box) && !points.some(b => b.overlaps(s.box))) ?? (free(spots[0].box) ? spots[0] : null)
            span.classList.toggle('crowded', !spot)
            span.style.marginTop = `${spot?.dy ?? 0}px`
            if (spot) placed.push(spot.box)
        }
    }
    map.on('zoomend overlayadd overlayremove', fit)
    fit()
    return () => { map.off('zoomend overlayadd overlayremove', fit) }
}
