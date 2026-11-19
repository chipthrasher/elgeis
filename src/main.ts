// Entry point

import L from 'leaflet'
import { loadConfig, showConfig } from './config.ts'
import { createMap } from './map.ts'
import { addPanes, colorPolygons, loadLayers, type MapLayer } from './layers.ts'
import { ObjectIndex } from './objects.ts'
import { createSidebar } from './sidebar.ts'
import { getParam, setParam } from './url.ts'

// The layers being viewed are kept in ?layers=, so views can be shared. With no
// param, the official layers show.
function initialLayers(layers: MapLayer[]): MapLayer[] {
    const param = getParam('layers')
    if (param === null) return layers.filter(l => l.layer.official)
    const ids = param.split(',')
    return layers.filter(l => ids.includes(l.layer.id))
}

function saveLayers(layers: MapLayer[], shown: MapLayer[]) {
    const isDefault = layers.every(l => shown.includes(l) === !!l.layer.official)
    setParam('layers', isDefault ? null : shown.map(l => l.layer.id).join(','))
}

async function main() {
    const [config, layers] = await Promise.all([loadConfig(), loadLayers()])
    const map = createMap(config.mapSize ?? 5500)
    addPanes(map)

    for (const l of initialLayers(layers)) l.group.addTo(map)
    const overlays = Object.fromEntries(layers.map(l => [l.layer.name, l.group]))
    L.control.layers(undefined, overlays, { collapsed: false, position: 'bottomleft' }).addTo(map)
    map.on('overlayadd overlayremove', () => saveLayers(layers, layers.filter(l => map.hasLayer(l.group))))

    const index = new ObjectIndex(layers.flatMap(l => l.objects))
    colorPolygons(index.all, o => index.colors(o))
    createSidebar(map, layers, index)
    showConfig(config)
}

main()
