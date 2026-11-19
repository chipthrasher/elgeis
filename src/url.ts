// Map state lives in the URL (?q=search&layers=a,b) so views can be shared.

export function getParam(name: string): string | null {
    return new URLSearchParams(location.search).get(name)
}

export function setParam(name: string, value: string | null) {
    const params = new URLSearchParams(location.search)
    if (value) params.set(name, value)
    else params.delete(name)
    // Commas are safe in a query string and keep ?layers= readable.
    const query = params.toString().replace(/%2C/g, ',')
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''))
}
