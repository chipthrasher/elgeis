// Database migrations, from the files in migrations/, run in name order.
// The backend migrates to the latest on startup.
//
// Usage: node backend/migrate.ts [latest|down]   (needs DATABASE_URL)

import fs from 'node:fs/promises'
import path from 'node:path'
import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration'
import { createDb, type Db } from './db.ts'

const migrator = (db: Db) => new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(import.meta.dirname, 'migrations') }),
})

function check({ error, results }: MigrationResultSet) {
    for (const r of results ?? []) console.log(`Migration ${r.migrationName} (${r.direction}): ${r.status}`)
    if (error) throw error
}

export const migrateToLatest = async (db: Db) => check(await migrator(db).migrateToLatest())
export const migrateDown = async (db: Db) => check(await migrator(db).migrateDown())

if (import.meta.main) {
    const db = createDb(process.env.DATABASE_URL!)
    try {
        await (process.argv[2] === 'down' ? migrateDown : migrateToLatest)(db)
    } finally {
        await db.destroy()
    }
}
