// Entry point

import L from 'leaflet'
import { createAccount, linkButton } from './account.ts'
import { api } from './api.ts'
import { createCommunity } from './community.ts'
import { createEditor } from './editor.ts'
import { emailSettings } from './notifications.ts'
import { createMap } from './map.ts'
import { addLabels } from './labels.ts'
import { addPanes, colorPolygons, loadLayers, type MapLayer } from './layers.ts'
import { ObjectIndex } from './objects.ts'
import { createSidebar } from './sidebar.ts'
import { getParam, setParam } from './url.ts'

// Everything that can be shown or hidden: each map layer, plus the dynmap
// image beneath them. Official layers and the dynmap are always in the layers
// control; community layers are turned on in their own list.
interface Toggle {
    id: string
    name: string
    group: L.Layer
    // Shown when there's no ?layers= param.
    byDefault: boolean
}

// What's being viewed is kept in ?layers=, so views can be shared.
function showInitial(map: L.Map, toggles: Toggle[]) {
    const param = getParam('layers')
    const ids = param?.split(',')
    for (const t of toggles) if (ids ? ids.includes(t.id) : t.byDefault) t.group.addTo(map)
}

function save(map: L.Map, toggles: Toggle[]) {
    const shown = toggles.filter(t => map.hasLayer(t.group))
    const isDefault = toggles.every(t => shown.includes(t) === t.byDefault)
    setParam('layers', isDefault ? null : shown.map(t => t.id).join(','))
}

// Layers that are loaded (so references to them resolve) but can't be shown.
// TODO: bring the Nether highway back.
const PAUSED = ['nether']

async function main() {
    let resolveEditor: (editor: ReturnType<typeof createEditor>) => void
    const ready = new Promise<ReturnType<typeof createEditor>>(resolve => { resolveEditor = resolve })
    createAccount(document.querySelector('#account')!, async user => {
        const editor = await ready
        // Reviewers get a link to what's waiting for them.
        const waiting = await api<unknown[]>('requests?review')
        return [
            linkButton('Update the map', () => editor.home()),
            linkButton('Your changes', () => editor.myRequests()),
            (waiting.length > 0 || user.role === 'admin') && linkButton(`Review${waiting.length ? ` (${waiting.length})` : ''}`, () => editor.reviewQueue()),
            user.role === 'admin' && linkButton('Moderate', () => editor.moderate()),
        ].filter((n): n is HTMLButtonElement => !!n)
    })
    const allLayers = await loadLayers()
    const layers = allLayers.filter(l => !PAUSED.includes(l.layer.id))
    const { map, dynmap } = createMap()
    addPanes(map)

    const toggleOf = (l: MapLayer): Toggle => ({ id: l.layer.id, name: l.layer.name, group: l.group, byDefault: !!l.layer.official })
    const toggles: Toggle[] = [...layers.map(toggleOf), { id: 'dynmap', name: 'Dynmap', group: dynmap, byDefault: true }]
    showInitial(map, toggles)
    const overlays = Object.fromEntries(toggles.filter(t => t.byDefault).map(t => [t.name, t.group]))
    const control = L.control.layers(undefined, overlays, { collapsed: false, position: 'bottomleft' })
    const community = createCommunity({
        map, layers, control,
        show: (...args) => editor.show(...args),
        // Someone made a new layer: carry on to its settings.
        created: l => {
            toggles.push(toggleOf(l))
            save(map, toggles)
            editor.settings(l.layer.id)
        },
    })
    // Controls in the bottom corners stack upwards, so the button sits beneath the layers control.
    community.button.addTo(map)
    control.addTo(map)
    map.on('overlayadd overlayremove', () => save(map, toggles))

    const index = new ObjectIndex(allLayers.flatMap(l => l.objects))
    colorPolygons(index.all, o => index.colors(o))
    addLabels(map, index.all, o => index.label(o))
    const editor = createEditor(map, layers, index)
    resolveEditor!(editor)
    createSidebar(map, layers, index, editor.pick)

    // Links in notification emails open a change request.
    const request = Number(getParam('request'))
    setParam('request', null)
    if (request) editor.openRequest(request).catch(e => editor.show('Change request', (e as Error).message))
    // And the setting for them, from the link at their foot, or the mail
    // client's Unsubscribe. The token stays out of the address bar, so it
    // isn't shared by accident.
    const token = getParam('notifications')
    setParam('notifications', null)
    if (token) emailSettings(token).then(node => editor.show('Email notifications', node), e => editor.show('Email notifications', (e as Error).message))
}

main()

// In development, reload when the frontend changes (see scripts/dev-frontend.ts).
// esbuild drops this from minified production builds.
if (process.env.NODE_ENV === 'development') new EventSource('/reload').onmessage = () => location.reload()
