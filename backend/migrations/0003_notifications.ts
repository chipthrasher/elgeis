// The email notification queue, and rate limits (Better Auth's and ours).

import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>) {
    await db.schema.createTable('emailQueue')
        .addColumn('id', 'integer', c => c.primaryKey().generatedAlwaysAsIdentity())
        .addColumn('userId', 'text', c => c.notNull().references('user.id').onDelete('cascade'))
        .addColumn('subject', 'text', c => c.notNull())
        .addColumn('text', 'text', c => c.notNull())
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
        .addColumn('sentAt', 'timestamptz')
        .addColumn('attempts', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('lastError', 'text')
        .execute()
    await db.schema.createIndex('emailQueue_unsent').on('emailQueue').column('id').where(sql.ref('sentAt'), 'is', null).execute()

    // As Better Auth's migration generator writes it.
    await sql`create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null)`.execute(db)
}

export async function down(db: Kysely<unknown>) {
    await db.schema.dropTable('rateLimit').execute()
    await db.schema.dropTable('emailQueue').execute()
}
