import { test } from 'node:test'
import assert from 'node:assert/strict'
import { borderWarnings, nearestOnLines } from './geometry.ts'
import type { Position } from './layer.ts'

const square = (x: number, z: number, size: number): Position[][][] =>
    [[[[x, z], [x + size, z], [x + size, z + size], [x, z + size], [x, z]]]]

test('nearestOnLines finds the closest block on any line', () => {
    const lines: Position[][] = [[[0, -100], [0, 100]], [[-100, 50], [100, 50]]]
    assert.deepEqual(nearestOnLines([28, -171], lines), { point: [0, -100], distance: Math.hypot(28, 71) })
    assert.deepEqual(nearestOnLines([-315, 45], lines)?.point, [-100, 50])
    assert.deepEqual(nearestOnLines([7, 3], lines)?.point, [0, 3])
    assert.equal(nearestOnLines([0, 0], []), null)
})

test('shared borders are fine', () => {
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'b', parts: square(10, 0, 10) }]), [])
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'far', parts: square(100, 0, 10) }]), [])
    // A neighbor touching along part of an edge, without a vertex there.
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'b', parts: square(10, 2, 5) }]), [])
})

test('overlaps and gaps are found', () => {
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'b', parts: square(5, 0, 10) }]).map(w => w.kind), ['overlap'])
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'b', parts: square(13, 0, 10) }]).map(w => w.kind), ['gap'])
    // Crossing edges, with no vertex inside the other.
    const plus: Position[][][] = [[[[4, -5], [6, -5], [6, 15], [4, 15], [4, -5]]]]
    assert.deepEqual(borderWarnings(square(0, 0, 10), [{ id: 'b', parts: plus }]).map(w => w.kind), ['overlap'])
    // A neighbor in a hole is fine.
    const withHole: Position[][][] = [[square(0, 0, 30)[0][0], square(10, 10, 10)[0][0]]]
    assert.deepEqual(borderWarnings(withHole, [{ id: 'b', parts: square(10, 10, 10) }]), [])
})
