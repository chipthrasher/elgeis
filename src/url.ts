// Map state lives in the URL's query (?q=search&layers=a,b&x=0&z=0&zoom=-3),
// and what's open in its path (/moderate/accounts), so both can be shared
// without one getting in the way of the other. Every path serves the page.

export function getParam(name: string): string | null {
    return new URLSearchParams(location.search).get(name)
}

// null removes the param; '' keeps it, empty.
export function setParam(name: string, value: string | null) {
    const params = new URLSearchParams(location.search)
    if (value !== null) params.set(name, value)
    else params.delete(name)
    // Commas are safe in a query string and keep ?layers= readable.
    const query = params.toString().replace(/%2C/g, ',')
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''))
}

export function setPath(path: string) {
    history.replaceState(null, '', path + location.search)
}

// A window's path while it's open, going back to the path before it once
// it's closed, unless something else has been opened since.
export function pathWhileOpen(dialog: HTMLDialogElement, path: string) {
    const before = location.pathname
    setPath(path)
    dialog.addEventListener('close', () => { if (location.pathname === path) setPath(before) })
}
