// Running layers. A layer's admins edit its name and schema (the fields its
// objects have), and pick its other admins. Site admins also mark layers
// official, hide or delete community layers, ban accounts, and read the audit log.

import { FIELD_TYPES, ICONS, type Field, type FieldType, type Layer } from '../shared/layer.ts'
import { getUser } from './account.ts'
import { api, type FullLayer } from './api.ts'
import { auditLog } from './audit.ts'
import { attempt, button, el, errorBox } from './dom.ts'
import { pathWhileOpen, setPath } from './url.ts'

type Show = (title: string, ...children: (Node | string | null | false)[]) => void

const TYPE_NAMES: Record<FieldType, string> = {
    text: 'Text', url: 'Link', color: 'Color', flag: 'Yes or no', reference: 'Other things on the map', entities: 'Political entities',
}

// A new field's key, from its label: "Map label" becomes "mapLabel".
function keyFor(label: string, taken: Set<string>): string {
    const base = label.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => c?.toUpperCase() ?? '').replace(/^[^a-z]+/, '') || 'field'
    let key = base
    for (let i = 2; taken.has(key); i++) key = base + i
    return key
}

const select = <T extends string>(options: [T, string][], value: T | undefined, onChange: (value: T) => void) => {
    const node = el('select', {}, options.map(([v, text]) => el('option', { value: v, selected: v === value }, text)))
    node.addEventListener('change', () => onChange(node.value as T))
    return node
}

const field = (label: string, ...inputs: Node[]) => el('label', { class: 'field' }, [el('span', {}, label), ...inputs])

export interface LayerInfo extends Layer {
    hidden: boolean
    // Waiting for a site admin's approval.
    pending: boolean
    createdBy: string | null
    creatorBanned: boolean
    admins: string[]
    canAdmin: boolean
}

interface UserInfo {
    id: string
    username: string | null
    email: string
    createdAt: string
    banned: boolean
    banReason: string | null
    // How many layers they've made.
    layers: number
}

export function layerAdmin(show: Show, load: (layerId: string, fresh: boolean) => Promise<FullLayer>) {
    /* A layer's settings, for its admins */

    async function settings(layerId: string, notice = '') {
        const [{ layer, objects }, user, infos] = await Promise.all([load(layerId, true), getUser().catch(() => null), api<LayerInfo[]>('layers')])
        const info = infos.find(i => i.id === layerId)
        const fields: Field[] = layer.fields.map(f => ({ ...f }))
        // Fields added here, whose keys come from their labels when saved.
        const added = new Set<Field>()
        let title = fields.find(f => f.key === layer.titleField)
        let label = fields.find(f => f.key === layer.labelField)

        const name = el('input', { value: layer.name })
        const hoverLines = el('input', { type: 'checkbox', checked: !!layer.hoverLines })
        // Typed, or picked; empty for none.
        const defaultColor = el('input', { value: layer.defaultColor ?? '', placeholder: 'None (grey)' })
        const colorPicker = el('input', { type: 'color', value: layer.defaultColor?.length === 7 ? layer.defaultColor : '#888888' })
        colorPicker.addEventListener('input', () => { defaultColor.value = colorPicker.value })
        defaultColor.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(defaultColor.value.trim())) colorPicker.value = defaultColor.value.trim() })
        const description = el('input', { value: layer.description ?? '', placeholder: 'What the layer shows (optional)' })
        const rows = el('div', { class: 'fields' })
        const choices = el('div')

        // Which text field is each object's title, and which its map label.
        function renderChoices() {
            const text = fields.filter(f => f.type === 'text')
            if (!text.includes(title!)) title = text[0]
            if (label && !text.includes(label)) label = undefined
            const options = text.map((f, i) => [String(i), f.label || 'Untitled'] as [string, string])
            choices.replaceChildren(
                field('Title field', select(options, String(text.indexOf(title!)), i => { title = text[Number(i)] })),
                field('Map label field', select([['', 'None'], ...options], label ? String(text.indexOf(label)) : '', i => { label = i ? text[Number(i)] : undefined })),
            )
        }

        function render() {
            rows.replaceChildren(...fields.map((f, i) => {
                const move = (by: number) => () => {
                    fields.splice(i, 1)
                    fields.splice(i + by, 0, f)
                    render()
                }
                const labelInput = el('input', { value: f.label, placeholder: 'Label' })
                labelInput.addEventListener('input', () => { f.label = labelInput.value; renderChoices() })
                const help = el('input', { value: f.description ?? '', placeholder: 'What it means (optional)' })
                help.addEventListener('input', () => { f.description = help.value || undefined })
                const ring = el('input', { type: 'checkbox', checked: !!f.ring })
                ring.addEventListener('change', () => { f.ring = ring.checked || undefined })
                return el('div', { class: 'schema-field' }, [
                    el('div', { class: 'row' }, [
                        labelInput,
                        select(FIELD_TYPES.map(t => [t, TYPE_NAMES[t]]), f.type, type => {
                            f.type = type
                            if (type !== 'flag') delete f.ring
                            if (type !== 'flag' && type !== 'text') delete f.icon
                            render()
                        }),
                    ]),
                    help,
                    el('div', { class: 'row' }, [
                        (f.type === 'flag' || f.type === 'text') && el('label', {}, ['Icon ',
                            select([['', 'None'], ...ICONS.map(i => [i, i] as [string, string])], f.icon ?? '', icon => { f.icon = (icon || undefined) as Field['icon'] })]),
                        f.type === 'flag' && el('label', { class: 'check' }, [ring, ' Ring on the map']),
                        added.has(f) ? el('span', { class: 'muted' }, 'New') : el('code', { class: 'muted' }, f.key),
                        i > 0 && button('↑', move(-1), 'link'),
                        i < fields.length - 1 && button('↓', move(1), 'link'),
                        button('Remove', () => {
                            if (!added.has(f) && !confirmRemoval(f)) return
                            fields.splice(i, 1)
                            render()
                        }, 'link'),
                    ]),
                ])
            }))
            renderChoices()
        }
        render()

        // Removing a saved field throws away every value it holds, so check first.
        function confirmRemoval(f: Field) {
            const holding = objects.filter(o => o.properties[f.key] !== undefined && o.properties[f.key] !== '').length
            const name = f.label || f.key
            return confirm(`Remove the "${name}" field?\n\n` + (holding
                ? `${holding} ${holding === 1 ? 'thing' : 'things'} in ${layer.name} ${holding === 1 ? 'has' : 'have'} a value for it. ` +
                  `When you save, those values are deleted from all of them, and anyone's change requests that set "${name}" will need updating.`
                : `Nothing in ${layer.name} has a value for it yet, so nothing is lost.`) +
                `\n\nIt only happens when you save. Adding the field back later won't bring the values back.`)
        }

        const error = errorBox()
        const save = () => attempt(error, async () => {
            const taken = new Set(fields.filter(f => !added.has(f)).map(f => f.key))
            const keys = new Map(fields.map(f => {
                const key = added.has(f) ? keyFor(f.label, taken) : f.key
                taken.add(key)
                return [f, key]
            }))
            await api(`layers/${layerId}`, {
                name: name.value,
                description: description.value,
                titleField: title ? keys.get(title) : '',
                labelField: label && keys.get(label),
                hoverLines: hoverLines.checked,
                defaultColor: defaultColor.value.trim(),
                fields: fields.map(f => ({ ...f, key: keys.get(f) })),
            }, 'PUT')
            settings(layerId, 'Saved. Reload the page to see the changes on the map.')
        })

        show(`${layer.name} settings`,
            notice && el('p', { class: 'notice' }, notice),
            field('Name', name),
            field('Description', description),
            el('h3', {}, 'Fields'),
            el('p', { class: 'muted' }, 'What each thing in the layer can have. Removing a field removes its values from everything in the layer.'),
            rows,
            el('div', { class: 'row' }, [button('Add a field', () => {
                const f: Field = { key: '', label: '', type: 'text' }
                added.add(f)
                fields.push(f)
                render()
                rows.querySelector<HTMLInputElement>('.schema-field:last-child input')?.focus()
            })]),
            choices,
            el('label', { class: 'field' }, [
                el('span', {}, 'Default color'),
                el('small', { class: 'help' }, "For areas without a color of their own, or from the political entities they list. Leave it empty for grey."),
                el('div', { class: 'row' }, [defaultColor, colorPicker]),
            ]),
            el('label', { class: 'check' }, [hoverLines, ' Lines show their hover card',
                el('small', { class: 'help' }, "Hovering a line shows its name, and clicking it finds it, like a point. Leave it off if the lines have no names, so they don't get in the way of what's beneath them.")]),
            error,
            el('div', { class: 'row' }, [button('Save', save, 'primary')]),
            await adminsSection(layerId),
            user?.role === 'admin' && info !== undefined && moderationSection(info),
        )
        setPath(`/layers/${layerId}/settings`)
    }

    // Whether the layer is official, hidden, or deleted, for site admins.
    // Official layers can't be hidden or deleted, and hidden ones can't be
    // made official.
    function moderationSection(info: LayerInfo) {
        const error = errorBox()
        const act = (action: () => Promise<string | null>) => () => attempt(error, async () => {
            const notice = await action()
            if (notice) settings(info.id, notice)
        })
        const toggleOfficial = act(async () => {
            if (!confirm(info.official
                ? `Are you sure you want to make ${info.name} a community layer?\n\nIt will stop showing on the map by default. This is a potentially destructive action.`
                : `Are you sure you want to make ${info.name} official?\n\nIt will show on the map by default. This is a potentially destructive action.`
            )) return null
            await api(`layers/${info.id}/official`, { official: !info.official })
            return `It's ${info.official ? 'a community layer' : 'official'} now. Reload the page to see the change on the map.`
        })
        const toggleHidden = act(async () => {
            await api(`layers/${info.id}/hidden`, { hidden: !info.hidden })
            return `It's ${info.hidden ? 'shown' : 'hidden'} now. Reload the page to see the change on the map.`
        })
        const remove = () => attempt(error, async () => {
            if (!confirm(`Delete ${info.name}, and every change request to it, for good?`)) return
            await api(`layers/${info.id}`, undefined, 'DELETE')
            show(info.name, el('p', { class: 'notice' }, 'Deleted. Reload the page to see the change on the map.'))
        })
        return el('div', {}, [
            el('h3', {}, 'Moderation'),
            el('p', { class: 'muted' }, info.official
                ? "It's official, so it shows on the map by default, and can't be hidden or deleted."
                : `It's a community layer${info.hidden ? ', hidden' : ''}, so people turn it on from "See more". Official layers show on the map by default. Hiding a layer takes it off the map until it's shown again.`),
            el('div', { class: 'row' }, [
                !info.pending && !info.hidden && button(info.official ? 'Make it a community layer' : 'Make it official', toggleOfficial, 'link'),
                !info.official && !info.pending && button(info.hidden ? 'Show' : 'Hide', toggleHidden, 'link'),
                !info.official && button('Delete', remove, 'link'),
            ]),
            error,
        ])
    }

    // The layer's admins, who review its change requests and edit its settings.
    async function adminsSection(layerId: string) {
        const list = el('div', { class: 'chips' })
        const error = errorBox()
        const render = (admins: string[]) => list.replaceChildren(...admins.map(username => {
            const remove = button('×', () => attempt(error, async () => {
                render(await api<string[]>(`layers/${layerId}/admins/${encodeURIComponent(username)}`, undefined, 'DELETE'))
            }), 'link')
            remove.title = 'Remove'
            return el('span', { class: 'chip' }, [username, remove])
        }))
        render(await api<string[]>(`layers/${layerId}/admins`))

        const username = el('input', { placeholder: 'Username' })
        const add = el('form', { class: 'row' }, [username, el('button', {}, 'Add')])
        add.addEventListener('submit', e => {
            e.preventDefault()
            attempt(error, async () => {
                render(await api<string[]>(`layers/${layerId}/admins`, { username: username.value }))
                username.value = ''
            })
        })
        return el('div', {}, [
            el('h3', {}, 'Admins'),
            el('p', { class: 'muted' }, 'They review change requests to this layer, and edit its settings.'),
            list, add, error,
        ])
    }

    /* Moderation, for site admins */

    // Its windows, each at /moderate/<name>.
    const moderationWindows = new Map<string, () => void>([
        ['layers', () => layerList(moderate)],
        ['accounts', () => users(moderate)],
        ['audit', auditLog],
    ])

    // Opens one of its windows too, if asked.
    async function moderate(open?: string) {
        const waiting = (await api<LayerInfo[]>('layers')).filter(l => l.pending).length
        show('Moderate',
            el('h3', {}, 'Layers'),
            el('p', { class: 'muted' }, 'New community layers wait for approval; rejecting one hides it.'),
            el('div', { class: 'row' }, button(`Layers${waiting ? ` (${waiting} waiting)` : ''}…`, moderationWindows.get('layers')!)),
            el('h3', {}, 'Accounts'),
            el('p', { class: 'muted' }, "Banned accounts are signed out, can't sign in or suggest changes, and their community layers are hidden until they're unbanned."),
            el('div', { class: 'row' }, button('Accounts…', moderationWindows.get('accounts')!)),
            el('h3', {}, 'Audit log'),
            el('p', { class: 'muted' }, 'Who signed up, signed in or failed to, and changed anything, for the past year.'),
            el('div', { class: 'row' }, button('Audit log…', moderationWindows.get('audit')!)),
        )
        setPath('/moderate')
        if (open) moderationWindows.get(open)?.()
    }

    // A window listing every layer, those waiting for approval first, to
    // approve or reject, with a gear to open each one's settings.
    // Calls back once it's closed if anything changed.
    function layerList(changed: () => void) {
        const dialog = el('dialog', { class: 'panel browse', 'aria-label': 'Layers' })
        const close = () => dialog.close()
        let dirty = false
        const list = el('div', { class: 'browse-list' })
        const error = errorBox()

        const render = () => attempt(error, async () => {
            const layers = (await api<LayerInfo[]>('layers')).sort((a, b) => Number(b.pending) - Number(a.pending))
            const act = (action: () => Promise<unknown>) => () => attempt(error, async () => {
                await action()
                dirty = true
                await render()
            })
            list.replaceChildren(...layers.map(l => {
                // Off to its settings, so don't go back to Moderate.
                const gear = button('⚙', () => { dirty = false; close(); settings(l.id) }, 'link gear')
                gear.title = 'Layer settings'
                gear.setAttribute('aria-label', `Settings for ${l.name}`)
                return el('div', { class: 'browse-row' }, [
                    el('span', { class: 'browse-text' }, [
                        el('span', { class: 'browse-head' }, el('span', { class: 'browse-name' }, l.name)),
                        el('small', {}, [
                            l.pending ? 'Waiting for approval' : l.official ? 'Official' : 'Community', l.hidden && ', hidden', l.createdBy && `, made by ${l.createdBy}`, l.creatorBanned && ' (banned)',
                        ].filter(Boolean).join('')),
                    ]),
                    el('div', { class: 'row' }, [
                        l.pending && button('Approve', act(() => api(`layers/${l.id}/pending`, { approved: true })), 'link'),
                        l.pending && button('Reject', act(async () => {
                            if (confirm(`Reject ${l.name}? It will be hidden, which you can undo with Show.`)) await api(`layers/${l.id}/pending`, { approved: false })
                        }), 'link'),
                    ]),
                    gear,
                ])
            }))
        })

        dialog.append(
            el('div', { class: 'panel-head' }, [el('h2', {}, 'Layers'), button('×', close, 'link close')]),
            el('p', { class: 'muted' }, 'Make a layer official, hide it, or delete it in its settings.'),
            error,
            list,
        )
        dialog.addEventListener('click', e => { if (e.target === dialog) close() })
        dialog.addEventListener('close', () => {
            dialog.remove()
            if (dirty) changed()
        })
        document.body.append(dialog)
        dialog.showModal()
        pathWhileOpen(dialog, '/moderate/layers')
        render()
    }

    // A window listing every account, newest first, to search and ban or
    // unban. Calls back once it's closed if anyone was banned or unbanned.
    function users(changed: () => void) {
        const dialog = el('dialog', { class: 'panel browse', 'aria-label': 'Accounts' })
        const close = () => dialog.close()
        let dirty = false
        const search = el('input', { type: 'search', placeholder: 'Search by username or email' })
        const bannedOnly = el('input', { type: 'checkbox' })
        const list = el('div', { class: 'browse-list' })
        const more = button('Show more', () => load(list.children.length), 'link')
        const error = errorBox()

        const row = (u: UserInfo): HTMLElement => {
            const name = u.username ?? 'No username yet'
            const toggle = button(u.banned ? 'Unban' : 'Ban', () => attempt(error, async () => {
                let reason: string | null = ''
                if (u.banned) {
                    if (!confirm(`Unban ${name}? They'll be able to sign in again, and their community layers will come back.`)) return
                } else {
                    reason = prompt(`Ban ${name} (${u.email})?\n\nThey'll be signed out, won't be able to sign in or suggest changes, and their community layers will be hidden until they're unbanned.\n\nWhy? (optional)`)
                    if (reason === null) return
                }
                await api(`users/${encodeURIComponent(u.id)}/banned`, { banned: !u.banned, reason: reason || undefined })
                dirty = true
                node.replaceWith(row({ ...u, banned: !u.banned, banReason: reason || null }))
            }), 'link')
            const node = el('div', { class: 'browse-row' }, [
                el('span', { class: 'browse-text' }, [
                    el('span', { class: 'browse-head' }, [
                        el('span', { class: 'browse-name' }, name),
                        u.banned && el('span', { class: 'banned', title: u.banReason ?? '' }, 'Banned'),
                        el('span', { class: 'admins' }, `${u.layers} ${u.layers === 1 ? 'layer' : 'layers'}`),
                    ]),
                    el('small', {}, `${u.email}, joined ${new Date(u.createdAt).toLocaleDateString()}`),
                ]),
                toggle,
            ])
            return node
        }

        // From the start, or more after what's listed. Only the latest
        // search's results are shown, however they arrive.
        let latest = 0
        const load = (offset = 0) => attempt(error, async () => {
            const call = ++latest
            const params = new URLSearchParams({ q: search.value.trim(), offset: String(offset) })
            if (bannedOnly.checked) params.set('banned', 'true')
            const page = await api<{ users: UserInfo[], more: boolean }>(`users?${params}`)
            if (call !== latest) return
            if (!offset) list.replaceChildren()
            list.append(...page.users.map(row))
            if (!list.children.length) list.append(el('p', { class: 'muted' }, 'Nobody matches.'))
            more.hidden = !page.more
        })
        let typing: ReturnType<typeof setTimeout>
        search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => load(), 250) })
        bannedOnly.addEventListener('change', () => load())

        dialog.append(
            el('div', { class: 'panel-head' }, [el('h2', {}, 'Accounts'), button('×', close, 'link close')]),
            search,
            el('label', { class: 'check' }, [bannedOnly, ' Only banned accounts']),
            error,
            list,
            el('div', { class: 'row' }, more),
        )
        dialog.addEventListener('click', e => { if (e.target === dialog) close() })
        dialog.addEventListener('close', () => {
            dialog.remove()
            if (dirty) changed()
        })
        document.body.append(dialog)
        dialog.showModal()
        pathWhileOpen(dialog, '/moderate/accounts')
        search.focus()
        load()
    }

    return { settings, moderate }
}
