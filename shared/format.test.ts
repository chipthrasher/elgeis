import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatJson } from './format.ts'

test('formatJson puts type and id first, geometry last, one position per line', () => {
    const text = formatJson({
        properties: { name: 'A', hidden: true, empty: undefined },
        geometry: { coordinates: [[0, 0], [1, 2]], type: 'LineString' },
        id: 'lin_a',
        type: 'Feature',
    })
    assert.equal(text, `{
  "type": "Feature",
  "id": "lin_a",
  "properties": {
    "hidden": true,
    "name": "A"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [0, 0],
      [1, 2]
    ]
  }
}
`)
})

test('formatJson is stable regardless of key order', () => {
    assert.equal(formatJson({ b: 1, a: [], c: {} }), formatJson({ c: {}, a: [], b: 1 }))
    assert.equal(formatJson({ a: [], c: {} }), '{\n  "a": [],\n  "c": {}\n}\n')
})
