// Names drawn inside polygons. Each name sits at the point deepest inside its
// polygon. Names that would overlap are hidden, with roomier polygons getting
// first pick, so small polygons get their names when nothing's in the way.

import L from 'leaflet'
import polylabel from 'polylabel'
import { DIMENSION_SCALE, type Position } from '../shared/layer.ts'
import { el } from './dom.ts'
import type { MapObject } from './layers.ts'
import { toLatLng } from './map.ts'

interface Label {
    span: HTMLElement
    latLng: L.LatLng
    // Radius of the largest circle inside the polygon, used as priority.
    room: number
}

export function addLabels(map: L.Map, objects: MapObject[], labelOf: (o: MapObject) => string) {
    map.createPane('labels').style.zIndex = '450' // above polygons and lines, below points
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
            pane: 'labels',
        }))
        labels.push({ span, latLng, room: pole.distance * scale })
    }

    labels.sort((a, b) => b.room - a.room)

    // Space kept between names, in pixels.
    const GAP = 4

    function fit() {
        const zoom = map.getZoom()
        const placed: L.Bounds[] = []
        for (const { span, latLng } of labels) {
            // Labels in hidden layers aren't in the page and measure 0.
            const size = L.point(span.offsetWidth + GAP, span.offsetHeight + GAP)
            if (size.x === GAP) continue
            const center = map.project(latLng, zoom)
            const box = L.bounds(center.subtract(size.divideBy(2)), center.add(size.divideBy(2)))
            const crowded = placed.some(b => b.overlaps(box))
            span.classList.toggle('crowded', crowded)
            if (!crowded) placed.push(box)
        }
    }
    map.on('zoomend overlayadd overlayremove', fit)
    fit()
}
