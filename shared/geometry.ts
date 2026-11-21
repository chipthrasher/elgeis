// Geometry helpers for the editor and the review view: where to connect a
// Nether portal to the highway, and where a polygon overlaps or leaves gaps
// with its neighbors.

import type { Geometry, Position } from './layer.ts'

type Segment = [Position, Position]

// A polygon's parts (one for a Polygon), each an outline plus any holes.
export function polygonParts(geometry: Geometry | null): Position[][][] {
    if (geometry?.type === 'Polygon') return [geometry.coordinates]
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates
    return []
}

function segments(rings: Position[][]): Segment[] {
    return rings.flatMap(ring => ring.slice(1).map((p, i): Segment => [ring[i], p]))
}

function closestOnSegment(p: Position, [a, b]: Segment): [number, number] {
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const length = dx * dx + dz * dz
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length)) : 0
    return [a[0] + t * dx, a[1] + t * dz]
}

const middle = ([a, b]: Segment): Position => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

// The closest block on any of the lines to p, for a portal's connector.
export function nearestOnLines(p: Position, lines: Position[][]): { point: Position, distance: number } | null {
    let best: { point: Position, distance: number } | null = null
    for (const segment of segments(lines)) {
        const c = closestOnSegment(p, segment)
        const point: Position = [Math.round(c[0]), Math.round(c[1])]
        const d = distance(p, point)
        if (!best || d < best.distance) best = { point, distance: d }
    }
    return best
}

export function contains(ring: Position[], p: Position): boolean {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j]
        if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside
    }
    return inside
}

const inParts = (p: Position, parts: Position[][][]) =>
    parts.some(([outline, ...holes]) => contains(outline, p) && !holes.some(h => contains(h, p)))

const toBorder = (p: Position, edges: Segment[]) => Math.min(...edges.map(s => distance(p, closestOnSegment(p, s))))

// Whether two segments cross at a point inside both (not just touching).
function cross([a, b]: Segment, [c, d]: Segment): boolean {
    const side = (p: Position, q: Position, r: Position) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function bounds(parts: Position[][][]) {
    const points = parts.flat(2)
    const xs = points.map(p => p[0]), zs = points.map(p => p[1])
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

// Whether there's open space between a vertex and the nearest point on the
// other border: the point halfway is in neither polygon and on neither border.
// Otherwise the vertex is just on an edge leading away from a shared border.
function isGap(p: Position, otherEdges: Segment[], both: Position[][][][], bothEdges: Segment[][]): boolean {
    const nearest = otherEdges.map(s => closestOnSegment(p, s)).reduce((a, b) => distance(p, a) <= distance(p, b) ? a : b)
    const m = middle([p, nearest as Position])
    return both.every(parts => !inParts(m, parts)) && bothEdges.every(edges => toBorder(m, edges) >= 0.5)
}

// How close, in blocks, two borders can be without touching before it's
// probably a gap someone missed.
export const GAP = 8

export interface BorderWarning {
    kind: 'overlap' | 'gap'
    // The neighbor's ID.
    with: string
    at: Position
}

// Where a polygon overlaps a neighbor, or nearly touches one without sharing
// its border. Borders that share vertices and edges are fine.
export function borderWarnings(parts: Position[][][], neighbors: { id: string, parts: Position[][][] }[]): BorderWarning[] {
    const warnings: BorderWarning[] = []
    if (!parts.length) return warnings
    const box = bounds(parts)
    const edges = segments(parts.flat())
    const vertices = parts.flat(2)

    for (const n of neighbors) {
        if (!n.parts.length) continue
        const b = bounds(n.parts)
        if (b.minX > box.maxX + GAP || b.maxX < box.minX - GAP || b.minZ > box.maxZ + GAP || b.maxZ < box.minZ - GAP) continue
        const theirEdges = segments(n.parts.flat())

        // Either one's vertices, and the middles of its edges (which catch
        // overlaps whose vertices are all on the other border), checked
        // against the other.
        const checks: [Position[], Segment[], Position[][][], Segment[]][] = [
            [vertices, edges, n.parts, theirEdges],
            [n.parts.flat(2), theirEdges, parts, edges],
        ]
        let overlap: Position | undefined, gap: Position | undefined
        for (const [points, ownEdges, other, otherEdges] of checks) {
            for (const p of [...points, ...ownEdges.map(middle)]) {
                if (toBorder(p, otherEdges) >= 0.5 && inParts(p, other)) overlap ??= p
            }
            for (const p of points) {
                const d = toBorder(p, otherEdges)
                if (!gap && d >= 0.5 && d <= GAP && !inParts(p, other) && isGap(p, otherEdges, [parts, n.parts], [edges, theirEdges])) gap = p
            }
        }
        if (!overlap) {
            const crossing = edges.find(e => theirEdges.some(t => cross(e, t)))
            if (crossing) overlap = crossing[0]
        }
        if (overlap) warnings.push({ kind: 'overlap', with: n.id, at: overlap })
        if (gap) warnings.push({ kind: 'gap', with: n.id, at: gap })
    }
    return warnings
}
