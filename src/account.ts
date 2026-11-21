// Signing up, in, and out, and changing your account, through the backend's
// auth API. People sign up with an email, username, and password, and confirm
// the email with a link we send. They sign in with their email or username and
// password, or with a link we email them instead. Nothing shows when there's
// no backend.

import { api } from './api.ts'
import { el } from './dom.ts'
import { emailSettings } from './notifications.ts'
import { getParam, setParam } from './url.ts'

export interface User {
    email: string
    username: string | null
    displayUsername: string | null
    role?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (path: string, body?: object) => api<any>('auth/' + path, body)

export const getUser = async (): Promise<User | null> => (await call('get-session'))?.user ?? null

// Links in our emails bring people back to this view of the map.
const here = () => location.pathname + location.search

export const linkButton = (text: string, onClick: () => void) => {
    const button = el('button', { type: 'button', class: 'link' }, text)
    button.addEventListener('click', onClick)
    return button
}

const input = (type: string, placeholder: string, autocomplete: string, value = '') =>
    Object.assign(el('input', { type, required: true, placeholder, autocomplete }), { value })
const password = (placeholder = 'Password', autocomplete = 'current-password') =>
    Object.assign(input('password', placeholder, autocomplete), { minLength: 8 })

// A form that shows what went wrong if submitting fails. One field sits beside
// its button; more stack above it.
function form(fields: HTMLInputElement[], label: string, onSubmit: (...values: string[]) => Promise<void>) {
    const error = el('div', { class: 'error' })
    const button = el('button', {}, label)
    const node = el('form', {}, [
        el('div', { class: fields.length > 1 ? 'row stack' : 'row' }, [...fields, button]),
        error,
    ])
    node.addEventListener('submit', async e => {
        e.preventDefault()
        error.textContent = ''
        button.disabled = true
        try {
            await onSubmit(...fields.map(f => f.type === 'password' ? f.value : f.value.trim()))
        } catch (e) {
            error.textContent = (e as Error).message
        } finally {
            button.disabled = false
        }
    })
    return node
}

const links = (...children: Node[]) => el('div', { class: 'links' }, children)

// `extraLinks` are shown once someone's signed in and has a username, e.g. to the editor.
export async function createAccount(box: HTMLElement, extraLinks: (user: User) => Promise<Node[]>) {
    let user: User | null
    try {
        user = await getUser()
    } catch {
        // No backend: nobody can sign in.
        return
    }
    const show = (...children: (Node | string)[]) => {
        box.replaceChildren(...children)
        box.querySelector('input')?.focus()
    }
    const back = () => linkButton('Back', () => signIn())

    function signedOut() {
        show(linkButton('Sign in', () => signIn()), ' or ', linkButton('sign up', signUp), ' to suggest changes to the map')
    }

    function signIn(notice = '') {
        const login = input('text', 'Email or username', 'username')
        show(notice, form([login, password()], 'Sign in', async (login, password) => {
            try {
                await (login.includes('@')
                    ? call('sign-in/email', { email: login, password, callbackURL: here() })
                    : call('sign-in/username', { username: login, password, callbackURL: here() }))
            } catch (e) {
                // Signing in sends the confirmation link again.
                if (/not verified/i.test((e as Error).message)) throw new Error('Check your email for a link to confirm it first.', { cause: e })
                throw e
            }
            user = await getUser()
            signedIn()
        }), links(linkButton('Forgot password?', forgotPassword), linkButton('Email me a link', emailLink), linkButton('Sign up', signUp)))
    }

    function signUp() {
        const fields = [input('text', 'Username', 'username'), input('email', 'Email', 'email'), password('Password (8+ characters)', 'new-password')]
        show(form(fields, 'Sign up', async (username, email, password) => {
            await call('sign-up/email', { username, displayUsername: username, name: username, email, password, callbackURL: here() })
            show(`Check ${email} for a link to confirm it, then you're in.`)
        }), links(linkButton('I already have an account', () => signIn())))
    }

    // Asks for an email, and sends it something.
    function askEmail(label: string, send: (email: string) => Promise<void>) {
        show(form([input('email', 'Your email', 'email')], label, async email => {
            await send(email)
            show(`Check ${email} for a link.`, links(back()))
        }), links(back()))
    }

    const emailLink = () => askEmail('Email me a link', email => call('sign-in/magic-link', { email, callbackURL: here() }))
    const forgotPassword = () => askEmail('Reset password', email => call('request-password-reset', { email, redirectTo: here() }))

    // Where the link in a password reset email lands.
    function newPassword(token: string) {
        show(form([password('New password', 'new-password')], 'Save', async newPassword => {
            await call('reset-password', { token, newPassword })
            signIn('Your new password is saved. Sign in with it.')
        }), links(back()))
    }

    function askUsername() {
        show(form([input('text', 'Pick a username', 'username')], 'Save', async username => {
            await call('update-user', { username, displayUsername: username, name: username })
            user = await getUser()
            signedIn()
        }), linkButton('Sign out', signOut))
    }

    async function signedIn(notice = '') {
        if (!user?.username) return askUsername()
        const extra = await extraLinks(user).catch(() => [])
        show(...notice ? [notice, el('br')] : [],
            'Signed in as ', el('strong', {}, user.displayUsername ?? user.username), ' · ',
            linkButton('Account', settings), ' · ', linkButton('Sign out', signOut),
            links(...extra))
    }

    async function settings() {
        if (!user) return
        const hasPassword = (await call('list-accounts').catch(() => [])).some((a: { providerId: string }) => a.providerId === 'credential')
        const notifications = await emailSettings().catch(() => null)
        const heading = (text: string) => el('div', {}, el('strong', {}, text))
        show(
            heading('Username'),
            form([input('text', 'Username', 'username', user.displayUsername ?? user.username ?? '')], 'Save', async username => {
                await call('update-user', { username, displayUsername: username, name: username })
                user = await getUser()
                signedIn('Your username is saved.')
            }),
            heading('Email'),
            form([input('email', 'Email', 'email', user.email)], 'Save', async newEmail => {
                await call('change-email', { newEmail, callbackURL: here() })
                signedIn(`Check ${newEmail} for a link to confirm it. Until then, your email stays ${user!.email}.`)
            }),
            heading('Password'),
            hasPassword
                ? form([password('Current password'), password('New password', 'new-password')], 'Change', async (currentPassword, newPassword) => {
                    await call('change-password', { currentPassword, newPassword })
                    signedIn('Your new password is saved.')
                })
                // People who've only signed in with a link set one like they'd reset it.
                : el('div', { class: 'row' }, linkButton('Email me a link to set a password', async () => {
                    await call('request-password-reset', { email: user!.email, redirectTo: here() })
                    signedIn(`Check ${user!.email} for a link to set a password.`)
                })),
            ...notifications ? [heading('Notifications'), notifications] : [],
            links(linkButton('Done', () => signedIn())),
        )
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

    // A link from one of our emails that didn't work comes back with ?error=,
    // and a password reset link that did with ?token=.
    const token = getParam('token')
    setParam('token', null)
    if (getParam('error')) {
        setParam('error', null)
        const problem = "That link didn't work. It may have expired or been used already."
        return user ? signedIn(problem) : signIn(problem)
    }
    if (token) newPassword(token)
    else if (user) signedIn()
    else signedOut()
}
