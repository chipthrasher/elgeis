// Entry point

import L from 'leaflet'
import { createAccount, linkButton } from './account.ts'
import { api } from './api.ts'
import { createEditor } from './editor.ts'
import { createMap } from './map.ts'
import { addLabels } from './labels.ts'
import { addPanes, colorPolygons, loadLayers } from './layers.ts'
import { ObjectIndex } from './objects.ts'
import { createSidebar } from './sidebar.ts'
import { getParam, setParam } from './url.ts'

// Everything the layers control can show or hide: each map layer, plus the
// dynmap image beneath them.
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
            linkButton('Contribute', () => editor.home()),
            linkButton('Your changes', () => editor.myRequests()),
            (waiting.length > 0 || user.role === 'admin') && linkButton(`Review${waiting.length ? ` (${waiting.length})` : ''}`, () => editor.reviewQueue()),
        ].filter((n): n is HTMLButtonElement => !!n)
    })
    const allLayers = await loadLayers()
    const layers = allLayers.filter(l => !PAUSED.includes(l.layer.id))
    const { map, dynmap } = createMap()
    addPanes(map)

    const toggles: Toggle[] = [
        ...layers.map(l => ({ id: l.layer.id, name: l.layer.name, group: l.group, byDefault: !!l.layer.official })),
        { id: 'dynmap', name: 'Dynmap', group: dynmap, byDefault: true },
    ]
    showInitial(map, toggles)
    const overlays = Object.fromEntries(toggles.map(t => [t.name, t.group]))
    L.control.layers(undefined, overlays, { collapsed: false, position: 'bottomleft' }).addTo(map)
    map.on('overlayadd overlayremove', () => save(map, toggles))

    const index = new ObjectIndex(allLayers.flatMap(l => l.objects))
    colorPolygons(index.all, o => index.colors(o))
    addLabels(map, index.all, o => index.label(o))
    const editor = createEditor(map, layers, index)
    resolveEditor!(editor)
    createSidebar(map, layers, index, editor.pick)
}

main()

// In development, reload when the frontend changes (see scripts/dev-frontend.ts).
// esbuild drops this from minified production builds.
if (process.env.NODE_ENV === 'development') new EventSource('/reload').onmessage = () => location.reload()
