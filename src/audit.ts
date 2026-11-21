// The audit log, for site admins: a window listing who did what, newest
// first, to search or narrow to what was refused. Entries are kept for a year.

import { api } from './api.ts'
import { attempt, button, el, errorBox } from './dom.ts'

interface Entry {
    id: number
    createdAt: string
    username: string | null
    ip: string
    action: string
    target: Record<string, string>
    status: number
}

// What each action means, by the backend's route for it. Others show as the route.
const LABELS: Record<string, string> = {
    'create account': 'Account created',
    'POST /auth/sign-up/email': 'Signed up',
    'GET /auth/verify-email': 'Confirmed an email',
    'POST /auth/sign-in/email': 'Signed in with a password',
    'POST /auth/sign-in/username': 'Signed in with a password',
    'POST /auth/sign-in/magic-link': 'Asked for a sign-in link',
    'GET /auth/magic-link/verify': 'Signed in with a link',
    'POST /auth/update-user': 'Changed their account',
    'POST /auth/change-email': 'Asked to change their email',
    'POST /auth/change-password': 'Changed their password',
    'POST /auth/request-password-reset': 'Asked to reset their password',
    'POST /auth/reset-password': 'Reset their password',
    'POST /requests': 'Started a change request',
    'PUT /requests/:id': 'Edited a change request',
    'POST /requests/:id/submit': 'Submitted a change request',
    'POST /requests/:id/withdraw': 'Withdrew a change request',
    'POST /requests/:id/comments': 'Commented on a change request',
    'POST /requests/:id/approve': 'Approved a change request',
    'POST /requests/:id/reject': 'Rejected a change request',
    'POST /layers': 'Made a layer',
    'PUT /layers/:id': "Edited a layer's settings",
    'POST /layers/:id/admins': 'Added a layer admin',
    'DELETE /layers/:id/admins/:username': 'Removed a layer admin',
    'POST /layers/:id/pending': 'Approved or rejected a new layer',
    'POST /layers/:id/official': 'Made a layer official, or not',
    'POST /layers/:id/hidden': 'Hid or showed a layer',
    'DELETE /layers/:id': 'Deleted a layer',
    'POST /users/:id/banned': 'Banned or unbanned an account',
    'PUT /notifications': 'Changed their email settings',
}

export function auditLog() {
    const dialog = el('dialog', { class: 'panel browse', 'aria-label': 'Audit log' })
    const close = () => dialog.close()
    const search = el('input', { type: 'search', placeholder: 'Search by username, email, ID, or address' })
    const failedOnly = el('input', { type: 'checkbox' })
    const list = el('div', { class: 'browse-list' })
    let last: number | undefined
    const more = button('Show more', () => load(last), 'link')
    const error = errorBox()

    const row = (e: Entry) => el('div', { class: 'browse-row' }, el('span', { class: 'browse-text' }, [
        el('span', { class: 'browse-head' }, [
            el('span', { class: 'browse-name' }, LABELS[e.action] ?? e.action),
            e.status >= 400 && el('span', { class: 'refused', title: `HTTP ${e.status}` }, 'Refused'),
            el('span', { class: 'admins' }, new Date(e.createdAt).toLocaleString()),
        ]),
        el('small', {}, [
            e.username ?? 'Someone', ` from ${e.ip}`,
            ...Object.entries(e.target).map(([key, value]) => `, ${key} ${value}`),
        ].join('')),
    ]))

    // From the newest, or older than `before`. Only the latest search's
    // results are shown, however they arrive.
    let latest = 0
    const load = (before?: number) => attempt(error, async () => {
        const call = ++latest
        const params = new URLSearchParams({ q: search.value.trim() })
        if (before) params.set('before', String(before))
        if (failedOnly.checked) params.set('failed', 'true')
        const page = await api<{ entries: Entry[], more: boolean }>(`audit?${params}`)
        if (call !== latest) return
        if (!before) list.replaceChildren()
        list.append(...page.entries.map(row))
        if (!list.children.length) list.append(el('p', { class: 'muted' }, 'Nothing matches.'))
        last = page.entries.at(-1)?.id
        more.hidden = !page.more
    })
    let typing: ReturnType<typeof setTimeout>
    search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => load(), 250) })
    failedOnly.addEventListener('change', () => load())

    dialog.append(
        el('div', { class: 'panel-head' }, [el('h2', {}, 'Audit log'), button('×', close, 'link close')]),
        search,
        el('label', { class: 'check' }, [failedOnly, ' Only refused actions, like failed sign-ins']),
        error,
        list,
        el('div', { class: 'row' }, more),
    )
    dialog.addEventListener('click', e => { if (e.target === dialog) close() })
    dialog.addEventListener('close', () => dialog.remove())
    document.body.append(dialog)
    dialog.showModal()
    search.focus()
    load()
}
