// Entry point

import { createAccount, linkButton } from './account.ts'
import { api } from './api.ts'
import { createCommunity } from './community.ts'
import { createEditor } from './editor.ts'
import { createLayerControl, type Toggle } from './layer-control.ts'
import { emailSettings } from './notifications.ts'
import { createMap } from './map.ts'
import { addLabels } from './labels.ts'
import { addPanes, colorPolygons, loadLayers, type MapLayer } from './layers.ts'
import { ObjectIndex } from './objects.ts'
import { createSidebar } from './sidebar.ts'
import { getParam, setParam } from './url.ts'

// Layers that are loaded (so references to them resolve) but can't be shown.
// TODO: bring the Nether highway back.
const PAUSED = ['nether']

async function main() {
    let resolveEditor: (editor: ReturnType<typeof createEditor>) => void
    const ready = new Promise<ReturnType<typeof createEditor>>(resolve => { resolveEditor = resolve })
    let openCommunity = () => {}
    createAccount(document.querySelector('#account')!, () => [linkButton('Community layers', () => openCommunity())], async user => {
        const editor = await ready
        // Reviewers get a link to what's waiting for them.
        const waiting = await api<unknown[]>('requests?review')
        return [
            linkButton('Edit', () => editor.home()),
            linkButton('Your changes', () => editor.myRequests()),
            (waiting.length > 0 || user.role === 'admin') && linkButton(`Review${waiting.length ? ` (${waiting.length})` : ''}`, () => editor.reviewQueue()),
            user.role === 'admin' && linkButton('Moderate', () => editor.moderate()),
        ].filter((n): n is HTMLButtonElement => !!n)
    })
    const allLayers = await loadLayers()
    const layers = allLayers.filter(l => !PAUSED.includes(l.layer.id))
    const { map, dynmap } = createMap()
    addPanes(map, allLayers.map(l => l.layer.id))

    // Everything that can be shown or hidden: each map layer, plus the dynmap
    // image beneath them. Official layers are listed in the layers control by
    // default, top first in the order they come in; community layers once
    // they're turned on in their own list.
    const toggleOf = (l: MapLayer): Toggle => ({ id: l.layer.id, name: l.layer.name, group: l.group, byDefault: !!l.layer.official, stacks: true })
    const control = createLayerControl(map, [...layers.map(toggleOf), { id: 'dynmap', name: 'Dynmap', group: dynmap, byDefault: true, stacks: false }])
    const community = createCommunity({
        map, layers, control,
        show: (...args) => editor.show(...args),
        // Someone made a new layer: carry on to its settings.
        created: l => {
            addPanes(map, [l.layer.id])
            control.add(toggleOf(l))
            editor.settings(l.layer.id)
        },
    })
    openCommunity = community.open

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
