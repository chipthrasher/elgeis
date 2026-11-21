// The editor: a panel for suggesting changes to the map as change requests,
// following your own requests, and reviewing others'. Forms are generated from
// each layer's schema, so nothing here knows about any particular layer.

import L from 'leaflet'
import { MAX_OPEN_REQUESTS, objectVersion, OPEN_STATUSES, opId, type Op } from '../shared/changes.ts'
import { nearestOnLines } from '../shared/geometry.ts'
import {
    DIMENSION_SCALE, idPrefixFor, newId,
    type Field, type Geometry, type Layer, type LayerObject, type Position, type PropertyValue,
} from '../shared/layer.ts'
import { api, type ChangeRequest, type FullLayer } from './api.ts'
import { el } from './dom.ts'
import { editShape, type ShapeEditor, type ShapeKind } from './draw.ts'
import type { MapLayer, MapObject } from './layers.ts'
import { toLatLng } from './map.ts'
import type { ObjectIndex } from './objects.ts'
import { Names } from './names.ts'
import { describeOp, showChanges, staleIds } from './review.ts'

interface Draft {
    id?: number
    layerId: string
    title: string
    ops: Op[]
}

const STATUS_TEXT: Record<string, string> = {
    draft: 'Draft', submitted: 'Waiting for review', stale: 'Needs updating',
    approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

const button = (text: string, onClick: () => void, cls = '') => {
    const b = el('button', { type: 'button', class: cls }, text)
    b.addEventListener('click', onClick)
    return b
}

export function createEditor(map: L.Map, layers: MapLayer[], index: ObjectIndex) {
    const panel = document.querySelector<HTMLElement>('#panel')!
    const cache = new Map<string, FullLayer>()
    // Shows entities and references by name; knows hidden objects once their
    // layer is loaded.
    const names = new Names(index)
    const nameOf = (layer: Layer, o: LayerObject) => names.describe(layer, o) || o.id
    let draft: Draft | null = null
    // The layer whose objects open in the editor when clicked on the map.
    let picking: string | null = null
    // Whether a shape is being drawn or edited, when clicks belong to it.
    let drawing = false
    // Undoes what the current view put on the map.
    let cleanup: (() => void) | null = null

    const load = async (layerId: string, fresh = false) => {
        if (fresh || !cache.has(layerId)) {
            const data = await api<FullLayer>(`layers/${layerId}`)
            cache.set(layerId, data)
            names.add(data)
        }
        return cache.get(layerId)!
    }

    function show(title: string, ...children: (Node | string | null | false)[]) {
        cleanup?.()
        cleanup = null
        picking = null
        panel.replaceChildren(
            el('div', { class: 'panel-head' }, [el('h2', {}, title), button('×', close, 'link close')]),
            ...children.filter((c): c is Node | string => !!c),
        )
        panel.classList.remove('hidden')
    }

    function close() {
        cleanup?.()
        cleanup = null
        picking = null
        panel.classList.add('hidden')
    }

    const errorBox = () => el('div', { class: 'error' })
    // Run an action, showing what went wrong in the box if it fails.
    async function attempt(box: HTMLElement, action: () => Promise<void>) {
        box.textContent = ''
        try {
            await action()
        } catch (e) {
            box.textContent = (e as Error).message
        }
    }

    /* Saving drafts */

    const toDraft = (r: ChangeRequest): Draft => ({ id: r.id, layerId: r.layerId, title: r.title, ops: r.ops })

    // Save the draft with these ops. The backend checks them, so a bad change
    // is refused before it's added.
    async function save(next: Draft) {
        const body = { title: next.title, ops: next.ops }
        const saved = next.id
            ? await api<ChangeRequest>(`requests/${next.id}`, body, 'PUT')
            : await api<ChangeRequest>('requests', { ...body, layerId: next.layerId })
        draft = toDraft(saved)
    }

    // Start or carry on a draft for this layer, picking up your latest one.
    async function draftFor(layerId: string): Promise<Draft> {
        if (draft?.layerId === layerId) return draft
        const mine = await api<ChangeRequest[]>('requests?mine')
        const open = mine.find(r => r.layerId === layerId && (r.status === 'draft' || r.status === 'stale'))
        return open ? toDraft(open) : { layerId, title: '', ops: [] }
    }

    async function setOp(layerId: string, ops: Op[], remove: string[] = []) {
        const current = await draftFor(layerId)
        const ids = new Set([...ops.map(opId), ...remove])
        const next = { ...current, ops: [...current.ops.filter(op => !ids.has(opId(op))), ...ops] }
        if (!next.title && next.ops.length) next.title = describeOp(names, await load(layerId), next.ops[0])
        await save(next)
    }

    /* Home: pick a layer, then an object */

    async function home(layerId = draft?.layerId ?? layers[0]?.layer.id) {
        if (!layerId) return
        const data = await load(layerId)
        const select = el('select', {}, layers.map(l => el('option', { value: l.layer.id, selected: l.layer.id === layerId }, l.layer.name)))
        select.addEventListener('change', () => home(select.value))

        const search = el('input', { type: 'search', placeholder: 'Find something to change' })
        const results = el('div', { class: 'results' })
        const list = () => {
            const q = search.value.toLowerCase()
            const matches = data.objects
                .map(o => ({ o, name: nameOf(data.layer, o) }))
                .filter(({ name }) => q && name.toLowerCase().includes(q))
                .slice(0, 30)
            results.replaceChildren(...matches.map(({ o, name }) =>
                button(name + (o.properties.hidden ? ' (hidden)' : '') + (o.geometry ? '' : ' (no shape)'), () => form(layerId, o.id), 'result')))
        }
        search.addEventListener('input', list)

        const current = draft?.layerId === layerId ? draft : null
        show('Update the map',
            el('label', {}, ['Layer ', select]),
            el('p', { class: 'muted' }, 'Click something on the map, or find it here, to change it. Hidden things are listed too.'),
            search, results,
            el('div', { class: 'row' }, [
                'New: ',
                ...(['Point', 'LineString', 'Polygon'] as const).map(kind =>
                    button({ Point: 'point', LineString: 'line', Polygon: 'area' }[kind], () => form(layerId, null, kind))),
                button('entry without a shape', () => form(layerId, null, null)),
            ]),
            current && current.ops.length > 0 && el('p', {}, [
                `Your change request has ${current.ops.length} change${current.ops.length === 1 ? '' : 's'}. `,
                button('Review and submit it', draftView, 'link'),
            ]),
        )
        picking = layerId
        search.focus()
    }

    /* The form for one object */

    // An input for a field, and how to read its value back.
    function fieldInput(field: Field, value: PropertyValue | undefined, original: PropertyValue | undefined) {
        const id = `field-${field.key}`
        const input = el('input', { id, value: typeof value === 'string' ? value : '' })
        // Entities and references are picked by name, any number of them (a
        // contested area has several entities), and stored by ID. A single
        // reference stays a string.
        const linked = () => {
            const ids = typeof value === 'string' ? [value] : Array.isArray(value) ? [...value] : []
            const chosen = el('div', { class: 'chips' })
            const render = () => chosen.replaceChildren(...ids.map((linkedId, i) => {
                const remove = button('×', () => { ids.splice(i, 1); render() }, 'link')
                remove.title = 'Remove'
                return el('span', { class: 'chip' }, [names.format(field, linkedId), remove])
            }))
            render()

            const options = names.options(field)
            input.value = ''
            input.placeholder = ids.length ? 'Add another' : 'Pick a name'
            input.setAttribute('list', id + '-list')
            const datalist = el('datalist', { id: id + '-list' }, options.map(option => el('option', { value: option })))
            // Move what's in the box into the list. Throws if it isn't a name.
            const add = () => {
                for (const linkedId of names.parse(field, input.value)) if (!ids.includes(linkedId)) ids.push(linkedId)
                input.value = ''
                input.placeholder = 'Add another'
                render()
            }
            // Picking a suggestion adds it right away; Enter adds what's typed.
            input.addEventListener('input', () => {
                input.setCustomValidity('')
                if (options.includes(input.value)) add()
            })
            input.addEventListener('keydown', e => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                try { add() } catch (err) { input.setCustomValidity((err as Error).message); input.reportValidity() }
            })

            const read = () => {
                add()
                if (ids.length === 0) return undefined
                return field.type === 'reference' && ids.length === 1 && !Array.isArray(original) ? ids[0] : [...ids]
            }
            return { node: labelled(field, input, datalist, chosen), read }
        }

        switch (field.type) {
            case 'flag': {
                const box = el('input', { id, type: 'checkbox', checked: value === true })
                return { node: el('label', { class: 'check' }, [box, ' ', field.label]), read: () => box.checked || undefined }
            }
            case 'color': {
                const picker = el('input', { type: 'color', value: typeof value === 'string' && value.length === 7 ? value : '#888888' })
                picker.addEventListener('input', () => { input.value = picker.value })
                input.placeholder = '#rrggbb'
                return { node: labelled(field, el('div', { class: 'row' }, [input, picker])), read: () => input.value.trim() || undefined }
            }
            case 'entities':
            case 'reference':
                return linked()
            case 'url':
                input.type = 'url'
                return { node: labelled(field, input), read: () => input.value.trim() || undefined }
            case 'text':
                return { node: labelled(field, input), read: () => input.value.trim() || undefined }
        }
    }

    const labelled = (field: Field, ...inputs: Node[]) =>
        el('label', { class: 'field', title: field.description }, [el('span', {}, field.label), ...inputs])

    // Edit an object (by ID), or make a new one of a kind (null: no shape).
    async function form(layerId: string, id: string | null, kind?: ShapeKind | null) {
        const data = await load(layerId)
        const { layer } = data
        const current = await draftFor(layerId)
        const original = id ? data.objects.find(o => o.id === id) : undefined
        const pending = current.ops.find(op => opId(op) === id)
        if (id && !original && pending?.op !== 'add') return home(layerId)
        // Start from the change already in the draft, if there is one.
        const start: LayerObject = pending && pending.op !== 'delete' ? pending.object : original ?? {
            type: 'Feature', id: '', geometry: null, properties: {},
        }
        const shapeKind: ShapeKind | null = kind !== undefined ? kind : shapeKindOf(start.geometry)

        const inputs = layer.fields.map(f => ({ field: f, ...fieldInput(f, start.properties[f.key], original?.properties[f.key]) }))
        const hidden = el('input', { type: 'checkbox', checked: start.properties.hidden === true })

        // The shape: unchanged unless it's edited.
        let geometry = start.geometry
        let shapeEditor: ShapeEditor | null = null
        const shapeBox = el('div', { class: 'shape' })
        const connector = portalConnector(data, start)

        function editGeometry() {
            if (!shapeKind) return
            // Hide the object's own drawing while its shape is edited.
            const showDrawn = hideDrawn(id ? [id] : [])
            const point = start.geometry?.type === 'GeometryCollection' ? start.geometry.geometries[0] : start.geometry
            shapeEditor = editShape(map, shapeKind, point, DIMENSION_SCALE[layer.dimension], () => {
                geometry = shapeEditor?.geometry() ?? null
                connector?.update(geometry)
            })
            drawing = true
            const stopShape = () => {
                drawing = false
                shapeEditor?.stop()
                connector?.stop()
                showDrawn()
            }
            const previous = cleanup
            cleanup = () => { stopShape(); previous?.() }
            shapeBox.replaceChildren(el('div', {}, [
                el('p', { class: 'muted' }, shapeHelp(shapeKind, !!start.geometry)),
                shapeKind === 'Polygon' && el('div', { class: 'row' }, [
                    button('Cut a hole', () => shapeEditor?.addRing('hole')),
                    button('Add another part', () => shapeEditor?.addRing('part')),
                ]),
                connector?.node,
            ]))
        }
        if (shapeKind) {
            shapeBox.append(button(start.geometry ? 'Edit the shape' : 'Draw it', editGeometry))
            if (!start.geometry) setTimeout(editGeometry)
        }

        const error = errorBox()
        function read(): LayerObject {
            const properties: Record<string, PropertyValue> = {}
            for (const { field, read } of inputs) {
                const value = read()
                if (value !== undefined) properties[field.key] = value
                // Leave fields that were empty as they were.
                else if (start.properties[field.key] === '') properties[field.key] = ''
            }
            if (hidden.checked) properties.hidden = true
            const g = shapeEditor && connector ? connector.wrap(geometry) : geometry
            return { type: 'Feature', id: start.id || newId(idPrefixFor(g)), geometry: g, properties }
        }

        async function submit() {
            await attempt(error, async () => {
                const object = read()
                if (shapeKind && !object.geometry) throw new Error('Draw its shape first')
                const ops: Op[] = [original
                    ? { op: 'update', baseVersion: objectVersion(original), object }
                    : { op: 'add', object }]
                await setOp(layerId, ops)
                draftView()
            })
        }

        async function remove() {
            await attempt(error, async () => {
                await setOp(layerId, original ? [{ op: 'delete', id: original.id, baseVersion: objectVersion(original) }] : [], [id!])
                draftView()
            })
        }

        show(original ? `Change ${nameOf(layer, original)}` : `New ${shapeKind ? { Point: 'point', LineString: 'line', Polygon: 'area' }[shapeKind] : 'entry'}`,
            el('p', { class: 'muted' }, `In ${layer.name}`),
            ...inputs.map(i => i.node),
            el('label', { class: 'check' }, [hidden, ' Hidden from the map']),
            shapeBox,
            error,
            el('div', { class: 'row' }, [
                button('Add to my change request', submit, 'primary'),
                (original || pending) && button(original ? 'Delete it' : 'Remove it', remove),
                button('Cancel', () => home(layerId), 'link'),
            ]),
        )
    }

    /* Nether portals: a suggested connector to the nearest highway line */

    function portalConnector(data: FullLayer, start: LayerObject) {
        if (data.layer.dimension !== 'nether' || shapeKindOf(start.geometry) !== 'Point') return null
        const scale = DIMENSION_SCALE[data.layer.dimension]
        const lines = data.objects
            .filter(o => o.geometry?.type === 'LineString' && !o.properties.hidden)
            .map(o => (o.geometry as { coordinates: Position[] }).coordinates)
        const had = start.geometry?.type === 'GeometryCollection'
        const box = el('input', { type: 'checkbox', checked: had || !start.geometry })
        const text = el('span', {}, 'Connect it to the nearest highway')
        const preview = L.polyline([], { className: 'connector', interactive: false }).addTo(map)
        let target: Position | null = null
        let point: Position | null = null

        const redraw = () => preview.setLatLngs(box.checked && point && target ? [point, target].map(([x, z]) => toLatLng(x * scale, z * scale)) : [])
        box.addEventListener('change', redraw)
        return {
            node: el('label', { class: 'check' }, [box, ' ', text]),
            update(g: Geometry | null) {
                point = g?.type === 'Point' ? g.coordinates : null
                const nearest = point && nearestOnLines(point, lines)
                target = nearest && nearest.distance > 0 ? nearest.point : null
                text.textContent = target ? `Connect it to the nearest highway (${Math.round(nearest!.distance)} blocks)` : 'Connect it to the nearest highway'
                redraw()
            },
            wrap(g: Geometry | null): Geometry | null {
                if (g?.type !== 'Point' || !box.checked || !target) return g
                return { type: 'GeometryCollection', geometries: [g, { type: 'LineString', coordinates: [g.coordinates, target] }] }
            },
            stop: () => preview.remove(),
        }
    }

    /* The draft */

    async function draftView() {
        if (!draft) return myRequests()
        const current = draft
        const data = await load(current.layerId)
        const error = errorBox()
        const title = el('input', { value: current.title, placeholder: 'What does this change?' })

        show('Your change request',
            el('p', { class: 'muted' }, `For ${data.layer.name}. Nothing goes live until a layer admin approves it.`),
            el('label', { class: 'field' }, [el('span', {}, 'Title'), title]),
            el('div', { class: 'changes' }, current.ops.map(op => el('div', { class: 'row op' }, [
                el('span', { class: `change-title ${op.op}` }, describeOp(names, data, op)),
                op.op !== 'delete' && button('Edit', () => form(current.layerId, opId(op)), 'link'),
                button('Remove', () => attempt(error, async () => {
                    await save({ ...current, ops: current.ops.filter(o => o !== op) })
                    draftView()
                }), 'link'),
            ]))),
            current.ops.length === 0 && el('p', { class: 'muted' }, 'No changes yet.'),
            error,
            el('div', { class: 'row' }, [
                button('Submit for review', () => attempt(error, async () => {
                    if (!current.id) throw new Error('Add a change first')
                    if (title.value.trim() !== current.title) await save({ ...current, title: title.value.trim() })
                    const r = await api<ChangeRequest>(`requests/${draft!.id}/submit`, {})
                    draft = null
                    openRequest(r.id)
                }), 'primary'),
                button('Add another change', () => attempt(error, async () => {
                    if (current.id && title.value.trim() !== current.title) await save({ ...current, title: title.value.trim() })
                    home(current.layerId)
                })),
                !!current.id && button('Throw it away', () => attempt(error, async () => {
                    await api(`requests/${current.id}/withdraw`, {})
                    draft = null
                    myRequests()
                }), 'link'),
            ]),
        )
    }

    /* Requests: yours, those to review, and one at a time */

    function requestList(requests: ChangeRequest[], empty: string) {
        if (requests.length === 0) return el('p', { class: 'muted' }, empty)
        return el('div', { class: 'requests' }, requests.map(r => {
            const b = button('', () => openRequest(r.id), 'request')
            b.append(
                el('span', {}, r.title || 'Untitled'),
                el('span', { class: `status ${r.status}` }, STATUS_TEXT[r.status] + (r.mine ? '' : ` · ${r.author ?? 'someone'}`)),
            )
            return b
        }))
    }

    async function myRequests() {
        const mine = await api<ChangeRequest[]>('requests?mine')
        const open = mine.filter(r => OPEN_STATUSES.includes(r.status)).length
        show('Your change requests',
            el('p', { class: 'muted' }, `${open} of ${MAX_OPEN_REQUESTS} open.`),
            requestList(mine, "You haven't suggested any changes yet."),
            button('Update the map', () => home(), 'primary'),
        )
    }

    async function reviewQueue() {
        const requests = await api<ChangeRequest[]>('requests?review')
        show('Waiting for review', requestList(requests, 'Nothing to review right now.'))
    }

    // Take objects' own drawings off the map. Returns a function that puts
    // them back.
    function hideDrawn(ids: string[]) {
        const restore = ids.flatMap(id => {
            const o = index.get(id)
            const group = o?.drawn && layers.find(l => l.layer === o.layer)?.group
            if (!group) return []
            group.removeLayer(o.drawn!)
            return [() => group.addLayer(o.drawn!)]
        })
        return () => restore.forEach(f => f())
    }

    async function openRequest(id: number) {
        const request = await api<ChangeRequest>(`requests/${id}`)
        const data = await load(request.layerId, true)
        const error = errorBox()
        const changes = el('div', { class: 'changes' })
        const comment = el('textarea', { placeholder: request.canReview && request.status === 'submitted' ? 'A note for the author (optional)' : 'Add a comment' })
        const act = (path: string, then: () => void) => () => attempt(error, async () => {
            await api(`requests/${id}/${path}`, { comment: comment.value })
            then()
        })
        const stale = request.mine && OPEN_STATUSES.includes(request.status) ? staleIds(data, request.ops) : []

        show(request.title || 'Untitled',
            el('p', { class: 'muted' }, [
                `${STATUS_TEXT[request.status]} · ${data.layer.name} · by ${request.author ?? 'someone'}`,
                request.reviewedBy && ` · reviewed by ${request.reviewedBy}`,
            ]),
            changes,
            stale.length > 0 && el('div', { class: 'warning' }, [
                'Some of what this changes has changed since. ',
                button('Update to the latest', () => attempt(error, async () => {
                    await save(rebase(data, request))
                    openRequest(id)
                }), 'link'),
                ' (your version replaces the newer one, so check it first)',
            ]),
            el('div', { class: 'comments' }, request.comments.map(c => el('div', { class: 'comment' }, [el('strong', {}, c.author ?? 'someone'), ' ', c.body]))),
            (request.mine || request.canReview) && comment,
            error,
            el('div', { class: 'row' }, [
                request.canReview && request.status === 'submitted' && button('Approve', act('approve', () => openRequest(id)), 'primary'),
                request.canReview && request.status === 'submitted' && button('Reject', act('reject', () => openRequest(id))),
                (request.mine || request.canReview) && button('Comment', () => attempt(error, async () => {
                    await api(`requests/${id}/comments`, { body: comment.value })
                    openRequest(id)
                }), 'link'),
                request.mine && OPEN_STATUSES.includes(request.status) && button('Edit', () => {
                    draft = toDraft(request)
                    draftView()
                }, 'link'),
                request.mine && OPEN_STATUSES.includes(request.status) && button('Withdraw', act('withdraw', myRequests), 'link'),
            ]),
        )
        // Hide what's on the map now, so only the request's before and after show.
        const showDrawn = hideDrawn(request.ops.map(opId))
        const hideChanges = showChanges(map, names, data, request, changes)
        cleanup = () => { hideChanges(); showDrawn() }
    }

    // Point a stale request's changes at the latest versions, dropping
    // changes to objects that are gone.
    function rebase(data: FullLayer, request: ChangeRequest): Draft {
        const ops = request.ops.flatMap((op): Op[] => {
            if (op.op === 'add') return [op]
            const current = data.objects.find(o => o.id === opId(op))
            return current ? [{ ...op, baseVersion: objectVersion(current) }] : []
        })
        return { ...toDraft(request), ops }
    }

    // Clicking something on the map, while picking, opens it in the editor.
    // Returns whether the editor took the click.
    function pick(o: MapObject): boolean {
        if (drawing) return true
        if (picking !== o.layer.id) return false
        form(o.layer.id, o.object.id)
        return true
    }

    return { home, myRequests, reviewQueue, pick }
}

function shapeKindOf(geometry: Geometry | null): ShapeKind | null {
    switch (geometry?.type) {
        case undefined: return null
        case 'Point': return 'Point'
        case 'LineString': return 'LineString'
        case 'Polygon':
        case 'MultiPolygon': return 'Polygon'
        case 'GeometryCollection': return shapeKindOf(geometry.geometries[0])
    }
}

function shapeHelp(kind: ShapeKind, existing: boolean): string {
    const snap = ' Corners snap to nearby corners; hold Alt to stop them.'
    if (kind === 'Point') return (existing ? 'Drag the point to move it.' : 'Click the map to place it.') + snap
    const what = kind === 'Polygon' ? 'area' : 'line'
    return (existing
        ? `Drag the corners to reshape the ${what}, drag the small markers between them to add corners, and right-click a corner to remove it.`
        : `Click the map to add corners, and click the ${kind === 'Polygon' ? 'first' : 'last'} corner again to finish.`) + snap
}
