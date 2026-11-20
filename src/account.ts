// Signing in and out, through the backend's auth API. People enter their
// email, open the link we send them, and pick a username the first time.
// Nothing shows when there's no backend, like under `npm run dev`.

import { el } from './dom.ts'
import { getParam, setParam } from './url.ts'

interface User {
    username: string | null
    displayUsername: string | null
}

async function call(path: string, body?: object) {
    const response = await fetch('/api/auth/' + path, body && {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new Error(json?.message ?? `Something went wrong (${response.status})`)
    return json
}

const getUser = async (): Promise<User | null> => (await call('get-session'))?.user ?? null

const linkButton = (text: string, onClick: () => void) => {
    const button = el('button', { type: 'button', class: 'link' }, text)
    button.addEventListener('click', onClick)
    return button
}

// A one-field form that shows what went wrong if submitting fails.
function form(input: HTMLInputElement, label: string, onSubmit: (value: string) => Promise<void>) {
    const error = el('div', { class: 'error' })
    const button = el('button', {}, label)
    const node = el('form', {}, [el('div', { class: 'row' }, [input, button]), error])
    node.addEventListener('submit', async e => {
        e.preventDefault()
        error.textContent = ''
        button.disabled = true
        try {
            await onSubmit(input.value.trim())
        } catch (e) {
            error.textContent = (e as Error).message
        } finally {
            button.disabled = false
        }
    })
    return node
}

export async function createAccount(box: HTMLElement) {
    let user: User | null
    try {
        user = await getUser()
    } catch {
        return
    }
    const show = (...children: (Node | string)[]) => {
        box.replaceChildren(...children)
        box.querySelector('input')?.focus()
    }

    function signedOut() {
        show(linkButton('Sign in', askEmail), ' to suggest changes to the map')
    }

    function askEmail(problem = '') {
        const input = el('input', { type: 'email', required: true, placeholder: 'Your email', autocomplete: 'email' })
        show(problem, form(input, 'Email me a link', async email => {
            // The link brings them back to this view of the map.
            await call('sign-in/magic-link', { email, callbackURL: location.pathname + location.search })
            show(`Check ${email} for a sign-in link.`)
        }))
    }

    function askUsername() {
        const input = el('input', { required: true, placeholder: 'Pick a username', autocomplete: 'username' })
        show(form(input, 'Save', async username => {
            await call('update-user', { username, displayUsername: username, name: username })
            user = await getUser()
            signedIn()
        }), linkButton('Sign out', signOut))
    }

    function signedIn() {
        if (!user?.username) return askUsername()
        show('Signed in as ', el('strong', {}, user.displayUsername ?? user.username), ' · ', linkButton('Sign out', signOut))
    }

    async function signOut() {
        try {
            await call('sign-out', {})
        } catch (e) {
            return show((e as Error).message, ' · ', linkButton('Try again', signOut))
        }
        user = null
        signedOut()
    }

    // A sign-in link that didn't work comes back with ?error=.
    if (getParam('error')) {
        setParam('error', null)
        if (!user) return askEmail("That sign-in link didn't work. It may have expired or been used already.")
    }
    if (user) signedIn()
    else signedOut()
}
