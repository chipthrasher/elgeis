// Entry point

import { createAccount, getUser, linkButton } from './account.ts'
import { api } from './api.ts'
import { createCommunity } from './community.ts'
import { createEditor } from './editor.ts'
import { createLayerControl, type Toggle } from './layer-control.ts'
import { emailSettings } from './notifications.ts'
import { createMap } from './map.ts'
import { addLabels } from './labels.ts'
import { addPanes, colorPolygons, loadLayers, loadPending, type MapLayer } from './layers.ts'
import { ObjectIndex } from './objects.ts'
import { createSidebar } from './sidebar.ts'
import { getParam, setParam, setPath } from './url.ts'

async function main() {
    let resolveEditor: (editor: ReturnType<typeof createEditor>) => void
    const ready = new Promise<ReturnType<typeof createEditor>>(resolve => { resolveEditor = resolve })
    let openNewLayer = () => {}
    createAccount(document.querySelector('#account')!, async user => {
        const editor = await ready
        // Reviewers, who are site admins and layer admins, get a link to
        // what's waiting for them, even when nothing is.
        const [waiting, layerInfos] = await Promise.all([api<unknown[]>('requests?review'), api<{ canAdmin: boolean }[]>('layers')])
        const reviews = user.role === 'admin' || layerInfos.some(l => l.canAdmin)
        return [
            linkButton('New layer', () => openNewLayer()),
            linkButton('Edit', () => editor.home()),
            linkButton('Your changes', () => editor.myRequests()),
            reviews && linkButton(`Review${waiting.length ? ` (${waiting.length})` : ''}`, () => editor.reviewQueue()),
            user.role === 'admin' && linkButton('Moderate', () => editor.moderate()),
        ].filter((n): n is HTMLButtonElement => !!n)
    })
    // Plus, for their admins, layers waiting for approval, to keep working on.
    const [built, pending] = await Promise.all([loadLayers(), loadPending()])
    const layers = [...built, ...pending.filter(p => !built.some(l => l.layer.id === p.layer.id))]
    const { map, dynmap } = createMap()
    addPanes(map, layers.map(l => l.layer.id))

    // Everything that can be shown or hidden: each map layer, plus the dynmap
    // image beneath them. Official layers are listed in the layers control by
    // default, top first in the order they come in; community layers once
    // they're turned on under its "See more".
    const toggleOf = (l: MapLayer): Toggle => ({ id: l.layer.id, name: l.layer.name, group: l.group, byDefault: !!l.layer.official, startsOff: l.layer.startsOff, base: l.layer.base, stacks: true })
    const community = createCommunity({
        layers,
        control: () => control,
        show: (...args) => editor.show(...args),
        settings: layerId => editor.settings(layerId),
        // Someone made a new layer: carry on to its settings.
        created: (l, pending) => {
            addPanes(map, [l.layer.id])
            control.add(toggleOf(l))
            editor.settings(l.layer.id, pending ? "Made. A site admin will look at it before it's listed for everyone; until then, only its admins see it." : '')
        },
    })
    const control = createLayerControl(map, [...layers.map(toggleOf), { id: 'dynmap', name: 'Dynmap Scrape', group: dynmap, byDefault: true, stacks: false }], community.browse)
    openNewLayer = community.openNew

    const index = new ObjectIndex(layers.flatMap(l => l.objects))
    colorPolygons(index.all, o => index.colors(o))
    addLabels(map, index.all, o => index.label(o))
    const editor = createEditor(map, layers, index)
    resolveEditor!(editor)
    createSidebar(map, layers, index, editor.pick)

    // What's open is in the path, like /moderate/accounts, for those allowed
    // to see it: site admins, or for a layer's settings, its admins.
    const [page, ...rest] = location.pathname.split('/').filter(Boolean)
    const [user, layerInfos] = await Promise.all([getUser().catch(() => null), api<{ id: string, canAdmin: boolean }[]>('layers').catch(() => [])])
    const failed = (title: string) => (e: unknown) => editor.show(title, (e as Error).message)
    if (page === 'moderate' && user?.role === 'admin') editor.moderate(rest[0]).catch(failed('Moderate'))
    else if (page === 'layers' && rest[1] === 'settings' && layerInfos.some(l => l.id === rest[0] && l.canAdmin)) editor.settings(rest[0]).catch(failed('Layer settings'))
    else setPath('/')

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
