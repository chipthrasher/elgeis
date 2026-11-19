// Creates a test site admin and a test regular user, for development. Sign in
// as either by entering their email and opening the link in Mailpit.
//
// Usage: node backend/seed.ts   (needs DATABASE_URL)

import { createDb, type Db } from './db.ts'

export const SEED_USERS = [
    { email: 'admin@example.com', username: 'admin', role: 'admin' },
    { email: 'user@example.com', username: 'user', role: 'user' },
]

export async function seed(db: Db) {
    await db.insertInto('user')
        .values(SEED_USERS.map(u => ({
            ...u,
            id: crypto.randomUUID(),
            name: u.username,
            displayUsername: u.username,
            emailVerified: true,
        })))
        .onConflict(c => c.column('email').doNothing())
        .execute()
}

if (import.meta.main) {
    const db = createDb(process.env.DATABASE_URL!)
    await seed(db)
    await db.destroy()
    console.log(`Seeded ${SEED_USERS.map(u => u.email).join(' and ')}`)
}
