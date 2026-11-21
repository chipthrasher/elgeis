// New community layers wait for a site admin's approval (existing layers are
// approved), and queued emails can go to an address rather than a user: the
// site's own, for approvals.

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>) {
    await db.schema.alterTable('layer').addColumn('pending', 'boolean', c => c.notNull().defaultTo(false)).execute()
    await db.schema.alterTable('emailQueue').alterColumn('userId', c => c.dropNotNull()).execute()
    await db.schema.alterTable('emailQueue').addColumn('to', 'text').execute()
}

export async function down(db: Kysely<unknown>) {
    await db.schema.alterTable('emailQueue').dropColumn('to').execute()
    await db.deleteFrom('emailQueue' as never).where('userId' as never, 'is', null).execute()
    await db.schema.alterTable('emailQueue').alterColumn('userId', c => c.setNotNull()).execute()
    await db.schema.alterTable('layer').dropColumn('pending').execute()
}
