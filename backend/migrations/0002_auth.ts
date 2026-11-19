// Better Auth's tables, for the magic link, username, and admin plugins, as
// its own migration generator writes them. Upgrading Better Auth or adding a
// plugin can need more columns; auth.test.ts checks nothing is missing.
// Also ties our tables' user IDs to users.

import { sql, type Kysely } from 'kysely'

const AUTH_TABLES = `
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "username" text unique, "displayUsername" text, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz);
create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "impersonatedBy" text);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
`

// [table, column, what happens to the row when its user is deleted]
const USER_COLUMNS = [
    ['layer', 'createdBy', 'set null'],
    ['layerAdmin', 'userId', 'cascade'],
    ['changeRequest', 'authorId', 'cascade'],
    ['changeRequest', 'reviewedBy', 'set null'],
    ['comment', 'authorId', 'cascade'],
] as const

export async function up(db: Kysely<unknown>) {
    for (const statement of AUTH_TABLES.trim().split('\n')) await sql.raw(statement).execute(db) // eslint-disable-line no-await-in-loop
    for (const [table, column, onDelete] of USER_COLUMNS) {
        await db.schema.alterTable(table) // eslint-disable-line no-await-in-loop
            .addForeignKeyConstraint(`${table}_${column}_fkey`, [column], 'user', ['id'], c => c.onDelete(onDelete))
            .execute()
    }
}

export async function down(db: Kysely<unknown>) {
    for (const [table, column] of USER_COLUMNS) await db.schema.alterTable(table).dropConstraint(`${table}_${column}_fkey`).execute() // eslint-disable-line no-await-in-loop
    for (const table of ['verification', 'account', 'session', 'user']) await db.schema.dropTable(table).execute() // eslint-disable-line no-await-in-loop
}
