// A fresh, migrated database for each test file, so tests can run in parallel.
// Tests that need one are skipped unless DATABASE_URL points at a Postgres
// server where they can create databases.

import { after } from 'node:test'
import pg from 'pg'
import { createDb, type Db } from './db.ts'
import { migrateToLatest } from './migrate.ts'

export const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL'

export async function testDb(): Promise<Db> {
    const url = new URL(process.env.DATABASE_URL!)
    const name = 'test_' + crypto.randomUUID().replaceAll('-', '')
    const admin = new pg.Client({ connectionString: url.href })
    await admin.connect()
    await admin.query(`create database ${name}`)

    url.pathname = '/' + name
    const db = createDb(url.href)
    await migrateToLatest(db)
    after(async () => {
        await db.destroy()
        await admin.query(`drop database ${name}`)
        await admin.end()
    })
    return db
}
