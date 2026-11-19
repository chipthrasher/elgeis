// Entry point

import L from 'leaflet'
import { loadConfig, showConfig } from './config.ts'
import { createMap } from './map.ts'
import { addPanes, loadLayers, type MapLayer } from './layers.ts'

// The layers being viewed are kept in ?layers=, so views can be shared. With no
// param, the official layers show.
function initialLayers(layers: MapLayer[]): MapLayer[] {
    const param = new URLSearchParams(location.search).get('layers')
    if (param === null) return layers.filter(l => l.layer.official)
    const ids = param.split(',')
    return layers.filter(l => ids.includes(l.layer.id))
}

function saveLayers(layers: MapLayer[], shown: MapLayer[]) {
    const params = new URLSearchParams(location.search)
    const isDefault = layers.every(l => shown.includes(l) === !!l.layer.official)
    if (isDefault) params.delete('layers')
    else params.set('layers', shown.map(l => l.layer.id).join(','))
    const query = params.toString().replace(/%2C/g, ',')
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''))
}

async function main() {
    const [config, layers] = await Promise.all([loadConfig(), loadLayers()])
    const map = createMap(config.mapSize ?? 5500)
    addPanes(map)

    for (const l of initialLayers(layers)) l.group.addTo(map)
    const overlays = Object.fromEntries(layers.map(l => [l.layer.name, l.group]))
    L.control.layers(undefined, overlays, { collapsed: false, position: 'bottomleft' }).addTo(map)
    map.on('overlayadd overlayremove', () => saveLayers(layers, layers.filter(l => map.hasLayer(l.group))))

    showConfig(config)
}

main()
