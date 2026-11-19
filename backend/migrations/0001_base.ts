import { sql, type Kysely } from 'kysely'

const now = sql`now()`

export async function up(db: Kysely<unknown>) {
    await db.schema.createTable('layer')
        .addColumn('id', 'text', c => c.primaryKey())
        .addColumn('createdBy', 'text')
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .addColumn('hidden', 'boolean', c => c.notNull().defaultTo(false))
        .execute()

    await db.schema.createTable('layerAdmin')
        .addColumn('layerId', 'text', c => c.notNull().references('layer.id').onDelete('cascade'))
        .addColumn('userId', 'text', c => c.notNull())
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .addPrimaryKeyConstraint('layerAdmin_pkey', ['layerId', 'userId'])
        .execute()

    await db.schema.createTable('changeRequest')
        .addColumn('id', 'integer', c => c.primaryKey().generatedAlwaysAsIdentity())
        .addColumn('layerId', 'text', c => c.notNull().references('layer.id').onDelete('cascade'))
        .addColumn('authorId', 'text', c => c.notNull())
        .addColumn('status', 'text', c => c.notNull().defaultTo('draft')
            .check(sql`status in ('draft', 'submitted', 'stale', 'approved', 'rejected', 'withdrawn')`))
        .addColumn('title', 'text', c => c.notNull().defaultTo(''))
        .addColumn('ops', 'jsonb', c => c.notNull().defaultTo(sql`'[]'`))
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .addColumn('updatedAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .addColumn('submittedAt', 'timestamptz')
        .addColumn('reviewedBy', 'text')
        .addColumn('reviewedAt', 'timestamptz')
        .addColumn('commit', 'text')
        .execute()
    await db.schema.createIndex('changeRequest_author').on('changeRequest').columns(['authorId', 'status']).execute()
    await db.schema.createIndex('changeRequest_layer').on('changeRequest').columns(['layerId', 'status']).execute()

    await db.schema.createTable('comment')
        .addColumn('id', 'integer', c => c.primaryKey().generatedAlwaysAsIdentity())
        .addColumn('changeRequestId', 'integer', c => c.notNull().references('changeRequest.id').onDelete('cascade'))
        .addColumn('authorId', 'text', c => c.notNull())
        .addColumn('body', 'text', c => c.notNull())
        .addColumn('createdAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .execute()
    await db.schema.createIndex('comment_changeRequest').on('comment').column('changeRequestId').execute()

    await db.schema.createTable('appState')
        .addColumn('key', 'text', c => c.primaryKey())
        .addColumn('value', 'jsonb', c => c.notNull())
        .addColumn('updatedAt', 'timestamptz', c => c.notNull().defaultTo(now))
        .execute()
}

export async function down(db: Kysely<unknown>) {
    for (const table of ['appState', 'comment', 'changeRequest', 'layerAdmin', 'layer']) {
        await db.schema.dropTable(table).execute() // eslint-disable-line no-await-in-loop
    }
}
