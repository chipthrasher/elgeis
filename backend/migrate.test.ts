import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'kysely'
import { migrateDown, migrateToLatest } from './migrate.ts'
import { skip, testDb } from './test-db.ts'

test('migrations go up, down, and up again', { skip }, async () => {
    const db = await testDb()
    const tables = async () => (await db.introspection.getTables()).map(t => t.name).sort()
    const migrated = await tables()
    assert.ok(migrated.includes('changeRequest'))

    for (let n = migrated.length; n > 0; n = (await tables()).length) await migrateDown(db) // eslint-disable-line no-await-in-loop
    await migrateToLatest(db)
    assert.deepEqual(await tables(), migrated)
})

test('change requests check their status and default to drafts', { skip }, async () => {
    const db = await testDb()
    await db.insertInto('layer').values({ id: 'political' }).execute()
    const request = await db.insertInto('changeRequest')
        .values({ layerId: 'political', authorId: 'u1', ops: JSON.stringify([{ op: 'delete' }]) })
        .returningAll().executeTakeFirstOrThrow()
    assert.equal(request.status, 'draft')
    assert.deepEqual(request.ops, [{ op: 'delete' }])

    await assert.rejects(sql`update "changeRequest" set status = 'bogus'`.execute(db))
})
