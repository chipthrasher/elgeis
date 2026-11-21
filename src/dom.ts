// Tiny DOM builders. Layer content is set via textContent and setAttribute
// (neither parses its input as HTML), so it can never inject script or markup
// the way an innerHTML string template would.

type Attrs = Record<string, string | boolean | null | undefined>
type Child = Node | string | null | undefined | false

// Build an HTML element: el('a', { href, class: 'wiki' }, 'Read more')
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Child | Child[] = []): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue
        node.setAttribute(name, value === true ? '' : value)
    }
    for (const child of ([] as Child[]).concat(children)) {
        if (child == null || child === false) continue
        node.append(child) // strings become text nodes; nodes are appended as-is
    }
    return node
}

// Parse a trusted (author-written, never user data) SVG string into a node,
// e.g. the static Feather icons.
export function svgFromMarkup(markup: string): Element {
    const tpl = document.createElement('template')
    tpl.innerHTML = markup
    return tpl.content.firstElementChild!
}

// Return url only if it uses a safe scheme, otherwise null. Blocks javascript:
// and data: URLs that would otherwise execute when a link is clicked.
export function safeUrl(url: string): string | null {
    try {
        const { protocol } = new URL(url, window.location.href)
        return protocol === 'http:' || protocol === 'https:' ? url : null
    } catch {
        return null
    }
}

export const button = (text: string, onClick: () => void, cls = '') => {
    const b = el('button', { type: 'button', class: cls }, text)
    b.addEventListener('click', onClick)
    return b
}

export const errorBox = () => el('div', { class: 'error' })

// Run an action, showing what went wrong in the box if it fails.
export async function attempt(box: HTMLElement, action: () => Promise<void>) {
    box.textContent = ''
    try {
        await action()
    } catch (e) {
        box.textContent = (e as Error).message
    }
}
