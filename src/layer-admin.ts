// Running layers. A layer's admins edit its name and schema (the fields its
// objects have), and pick its other admins. Site admins also mark layers
// official, hide or delete community layers, and ban accounts.

import { FIELD_TYPES, ICONS, type Field, type FieldType, type Layer } from '../shared/layer.ts'
import { api, type FullLayer } from './api.ts'
import { attempt, button, el, errorBox } from './dom.ts'

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
    createdBy: string | null
    admins: string[]
    canAdmin: boolean
}

interface AuthUser {
    id: string
    username: string
    displayUsername: string | null
    banReason: string | null
}

export function layerAdmin(show: Show, load: (layerId: string, fresh: boolean) => Promise<FullLayer>) {
    /* A layer's settings, for its admins */

    async function settings(layerId: string, notice = '') {
        const { layer, objects } = await load(layerId, true)
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
        )
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

    async function moderate() {
        const layers = await api<LayerInfo[]>('layers')
        const error = errorBox()
        const act = (action: () => Promise<unknown>) => () => attempt(error, async () => {
            await action()
            moderate()
        })

        const banned = (await api<{ users: AuthUser[] }>('auth/admin/list-users?filterField=banned&filterValue=true&limit=100')).users
        const username = el('input', { placeholder: 'Username' })
        const reason = el('input', { placeholder: 'Why (optional)' })
        const ban = el('form', { class: 'row' }, [username, reason, el('button', {}, 'Ban')])
        ban.addEventListener('submit', e => {
            e.preventDefault()
            act(async () => {
                const { users } = await api<{ users: AuthUser[] }>(`auth/admin/list-users?filterField=username&filterValue=${encodeURIComponent(username.value.trim().toLowerCase())}`)
                if (!users.length) throw new Error(`Nobody has the username "${username.value.trim()}"`)
                await api('auth/admin/ban-user', { userId: users[0].id, banReason: reason.value.trim() || undefined })
            })()
        })

        show('Moderate',
            el('h3', {}, 'Layers'),
            el('p', { class: 'muted' }, 'Official layers show by default. Hiding a community layer takes it off the map until it\'s shown again.'),
            el('div', { class: 'moderated' }, layers.map(l => el('div', { class: 'change' }, [
                el('div', {}, [el('strong', {}, l.name), ' ', el('span', { class: 'muted' }, [
                    l.official ? 'Official' : 'Community', l.hidden && ', hidden', l.createdBy && `, made by ${l.createdBy}`,
                ].filter(Boolean).join(''))]),
                el('div', { class: 'row' }, [
                    button('Settings', () => settings(l.id), 'link'),
                    !l.hidden && button(l.official ? 'Make it a community layer' : 'Make it official', act(async () => {
                        if (confirm(l.official
                            ? `Are you sure you want to make ${l.name} a community layer?\n\nIt will stop showing on the map by default. This is a potentially destructive action.`
                            : `Are you sure you want to make ${l.name} official?\n\nIt will show on the map by default. This is a potentially destructive action.`
                        )) await api(`layers/${l.id}/official`, { official: !l.official })
                    }), 'link'),
                    !l.official && button(l.hidden ? 'Show' : 'Hide', act(() => api(`layers/${l.id}/hidden`, { hidden: !l.hidden })), 'link'),
                    !l.official && button('Delete', act(async () => {
                        if (confirm(`Delete ${l.name}, and every change request to it, for good?`)) await api(`layers/${l.id}`, undefined, 'DELETE')
                    }), 'link'),
                ]),
            ]))),
            el('h3', {}, 'Bans'),
            el('p', { class: 'muted' }, 'Banned accounts are signed out, and can\'t sign in or suggest changes.'),
            ban,
            error,
            banned.length > 0 && el('div', { class: 'chips' }, banned.map(u => {
                const unban = button('Unban', act(() => api('auth/admin/unban-user', { userId: u.id })), 'link')
                return el('span', { class: 'chip', title: u.banReason ?? '' }, [u.displayUsername ?? u.username, ' ', unban])
            })),
        )
    }

    return { settings, moderate }
}
