// config.json is published alongside the site with the live map size, the
// deployed version, and when the map data was last updated. It's optional.

import { el } from './dom.ts'

export interface Config {
    // Distance between the world border and (0, 0) in the Overworld.
    mapSize?: number
    version?: string
    lastUpdated?: string
}

export async function loadConfig(): Promise<Config> {
    try {
        const res = await fetch('config.json', { cache: 'no-store' })
        if (res.ok) return await res.json()
    } catch { /* fall back to defaults */ }
    return {}
}

export function showConfig({ version, lastUpdated }: Config) {
    const box = document.querySelector('.version')!
    if (version) box.append(el('div', {}, 'Version ' + version))

    // E.g. "2024-06-01T12:00:00Z" -> "June 1, 2024, 12:00 PM UTC".
    const date = lastUpdated ? new Date(lastUpdated) : null
    if (date && !isNaN(date.getTime())) {
        const formatted = date.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        })
        box.append(el('div', {}, ['Map data last updated:', el('br'), formatted]))
    }
}
