// Canonical JSON formatting for layer files, so the same data always produces
// the same text and git diffs stay small.
//
// - Keys are sorted, except `type` and `id` come first and geometry comes last.
// - Arrays of plain values are kept on one line, so each coordinate pair is one
//   line and moving a vertex changes exactly one line.
// - Two-space indent and a trailing newline.

const FIRST = ['type', 'id']
const LAST = ['geometry', 'geometries', 'coordinates']

function rank(key: string): number {
    if (FIRST.includes(key)) return FIRST.indexOf(key) - FIRST.length
    return LAST.includes(key) ? 1 : 0
}

function compareKeys(a: string, b: string): number {
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
}

const isPlain = (v: unknown) => v === null || typeof v !== 'object'

function format(value: unknown, indent: string): string {
    const inner = indent + '  '

    if (Array.isArray(value)) {
        if (value.every(isPlain)) return '[' + value.map(v => JSON.stringify(v)).join(', ') + ']'
        return '[\n' + value.map(v => inner + format(v, inner)).join(',\n') + '\n' + indent + ']'
    }

    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, v]) => v !== undefined)
        if (entries.length === 0) return '{}'
        return '{\n' + entries
            .sort(([a], [b]) => compareKeys(a, b))
            .map(([k, v]) => inner + JSON.stringify(k) + ': ' + format(v, inner))
            .join(',\n') + '\n' + indent + '}'
    }

    return JSON.stringify(value)
}

export function formatJson(value: unknown): string {
    return format(value, '') + '\n'
}
