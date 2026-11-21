// Whether you get notification emails: change requests to review, and what
// happens to yours. Shown in your account settings, and opened by the link in
// each email (and the mail client's own Unsubscribe), which carries a token
// so it works without signing in.

import { api } from './api.ts'
import { el } from './dom.ts'

export async function emailSettings(token?: string): Promise<Node> {
    const path = 'notifications' + (token ? `?token=${encodeURIComponent(token)}` : '')
    const { enabled, email } = await api<{ enabled: boolean, email: string }>(path)
    const box = el('input', { type: 'checkbox', checked: enabled })
    const status = el('div', { class: 'muted' })
    box.addEventListener('change', async () => {
        status.textContent = ''
        try {
            await api(path, { enabled: box.checked }, 'PUT')
            status.textContent = box.checked ? `Notifications will go to ${email}.` : `No more notifications will go to ${email}.`
        } catch (e) {
            box.checked = !box.checked
            status.textContent = (e as Error).message
        }
    })
    return el('div', {}, [
        el('label', { class: 'check' }, [box, ' Email me about change requests to review, and about mine']),
        status,
    ])
}
