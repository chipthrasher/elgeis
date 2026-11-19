import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from './main.ts'

test('the API says hello', async () => {
    const response = await app.request('/api')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { hello: 'Elgeis' })
})
