import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeChanges } from './changes.ts'
import type { LayerObject } from './layer.ts'

const square = (size: number): LayerObject['geometry'] => ({ type: 'Polygon', coordinates: [[[0, 0], [size, 0], [size, size], [0, 0]]] })
const polygon = (properties: LayerObject['properties'], size = 10): LayerObject => ({ type: 'Feature', id: 'pol_a', geometry: square(size), properties })

test('fields changed on one side take that side', () => {
    const base = polygon({ name: 'A', color: '#ff0000' })
    const theirs = polygon({ name: 'A', color: '#00ff00' })
    const mine = polygon({ name: 'B', color: '#ff0000' }, 20)
    const { merged, kept, conflicts } = mergeChanges(base, theirs, mine)
    assert.deepEqual(merged, polygon({ name: 'B', color: '#00ff00' }, 20))
    assert.deepEqual(kept, ['color'])
    assert.deepEqual(conflicts, [])
})

test('fields changed differently on both sides are conflicts, keeping yours', () => {
    const base = polygon({ name: 'A' })
    const theirs = polygon({ name: 'B', label: 'Bee' }, 15)
    const mine = polygon({ name: 'C' }, 20)
    const { merged, kept, conflicts } = mergeChanges(base, theirs, mine)
    assert.deepEqual(merged, { ...polygon({ name: 'C', label: 'Bee' }, 20) })
    assert.deepEqual(kept, ['label'])
    assert.deepEqual(conflicts, ['geometry', 'name'])
})

test('the same change on both sides is no conflict', () => {
    const { conflicts, kept } = mergeChanges(polygon({ name: 'A' }), polygon({ name: 'B' }), polygon({ name: 'B' }))
    assert.deepEqual([conflicts, kept], [[], []])
})

test('without the original, every difference is a conflict', () => {
    const { merged, conflicts } = mergeChanges(null, polygon({ name: 'A', color: '#00ff00' }), polygon({ name: 'B' }))
    assert.deepEqual(conflicts, ['name', 'color'])
    assert.deepEqual(merged, polygon({ name: 'B' }))
})
