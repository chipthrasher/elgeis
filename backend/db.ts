// The Postgres database, through Kysely. Columns are camelCase, like Better
// Auth's, so names are the same in SQL and TypeScript.

import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely'
import pg from 'pg'
import type { Op, Status } from '../shared/changes.ts'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
// jsonb columns are read as parsed JSON but written as JSON text, since pg
// would otherwise send JS arrays as Postgres arrays.
type Json<T> = ColumnType<T, string, string>


export interface Database {
    // Better Auth's, with only the columns we use. It has more tables too.
    user: {
        id: string
        name: string
        email: string
        emailVerified: boolean
        username: string | null
        displayUsername: string | null
        // "admin" for site admins.
        role: string | null
        banned: boolean | null
        createdAt: Generated<Date>
        updatedAt: Generated<Date>
    }
    // Every layer, official or community. The manifest itself (name, schema)
    // is in the layers repo; this is what Postgres needs to know about it.
    layer: {
        id: string
        createdBy: string | null
        createdAt: Generated<Date>
        // Hidden by a site admin: left out of the community layer list.
        hidden: Generated<boolean>
    }
    layerAdmin: {
        layerId: string
        userId: string
        createdAt: Generated<Date>
    }
    changeRequest: {
        id: Generated<number>
        layerId: string
        authorId: string
        status: Generated<Status>
        title: Generated<string>
        ops: Json<Op[]>
        createdAt: Generated<Date>
        updatedAt: Generated<Date>
        submittedAt: Timestamp | null
        reviewedBy: string | null
        reviewedAt: Timestamp | null
        // The layers repo commit an approved request became.
        commit: string | null
    }
    comment: {
        id: Generated<number>
        changeRequestId: number
        authorId: string
        body: string
        createdAt: Generated<Date>
    }
    // Email notifications waiting to be sent (see notify.ts).
    emailQueue: {
        id: Generated<number>
        userId: string
        subject: string
        text: string
        createdAt: Generated<Date>
        sentAt: Timestamp | null
        attempts: Generated<number>
        lastError: string | null
    }
    // Better Auth's rate limits, by client address and path, and ours (see
    // rate-limit.ts). lastRequest is in milliseconds.
    rateLimit: {
        id: string
        key: string
        count: number
        lastRequest: ColumnType<string, number, number>
    }
    // Small bits of state that don't need a table of their own.
    appState: {
        key: string
        value: Json<unknown>
        updatedAt: Generated<Date>
    }
}

export type Db = Kysely<Database>

export function createDb(connectionString: string): Db {
    return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }) })
}
