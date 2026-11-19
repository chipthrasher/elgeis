// Names drawn inside polygons. Each name sits at the point deepest inside its
// polygon, and only shows once the largest circle that fits there is wide
// enough for the text, so small polygons get their names as you zoom in.

import L from 'leaflet'
import polylabel from 'polylabel'
import { DIMENSION_SCALE, type Position } from '../shared/layer.ts'
import { el } from './dom.ts'
import type { MapObject } from './layers.ts'
import { toLatLng } from './map.ts'

interface Label {
    span: HTMLElement
    // Diameter of the largest circle inside the polygon, in blocks at its spot.
    room: number
}

export function addLabels(map: L.Map, objects: MapObject[], titleOf: (o: MapObject) => string) {
    map.createPane('labels').style.zIndex = '450' // above polygons and lines, below points
    const labels: Label[] = []

    for (const o of objects) {
        const geometry = o.object.geometry
        const title = titleOf(o)
        if (!o.drawn || !title || (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon')) continue

        // For a MultiPolygon, label the part with the most room.
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        const pole = polygons.map(p => polylabel(p as Position[][], 1)).reduce((a, b) => b.distance > a.distance ? b : a)
        const scale = DIMENSION_SCALE[o.layer.dimension]

        const span = el('span', {}, title)
        // Added to the object's own group, so it shares the object's toggling,
        // hover card, highlighting, and search classes.
        o.drawn.addLayer(L.marker(toLatLng(pole[0] * scale, pole[1] * scale), {
            icon: L.divIcon({ className: 'polygon-label', html: span }),
            interactive: false,
            keyboard: false,
            pane: 'labels',
        }))
        labels.push({ span, room: 2 * pole.distance * scale })
    }

    // In Leaflet's Simple CRS, one block is 2^zoom pixels.
    function fit() {
        const pixelsPerBlock = 2 ** map.getZoom()
        for (const { span, room } of labels) {
            span.classList.toggle('too-small', span.offsetWidth > room * pixelsPerBlock)
        }
    }
    map.on('zoomend overlayadd', fit)
    fit()
}
