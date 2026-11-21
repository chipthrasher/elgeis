// Whether each user gets email notifications.

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>) {
    await db.schema.alterTable('user').addColumn('emailNotifications', 'boolean', c => c.notNull().defaultTo(true)).execute()
}

export async function down(db: Kysely<unknown>) {
    await db.schema.alterTable('user').dropColumn('emailNotifications').execute()
}
