// Map state lives in the URL (?q=search&layers=a,b&x=0&z=0&zoom=-3) so views
// can be shared.

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
