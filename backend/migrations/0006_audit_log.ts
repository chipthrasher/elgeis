// The audit log, for site admins (see audit.ts).

import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>) {
    await db.schema.createTable('auditLog')
        .addColumn('id', 'integer', c => c.primaryKey().generatedAlwaysAsIdentity())
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
        .addColumn('userId', 'text', c => c.references('user.id').onDelete('set null'))
        .addColumn('username', 'text')
        .addColumn('ip', 'text', c => c.notNull())
        .addColumn('action', 'text', c => c.notNull())
        .addColumn('target', 'jsonb', c => c.notNull())
        .addColumn('status', 'integer', c => c.notNull())
        .execute()
    await db.schema.createIndex('auditLog_createdAt').on('auditLog').column('createdAt').execute()
}

export async function down(db: Kysely<unknown>) {
    await db.schema.dropTable('auditLog').execute()
}
