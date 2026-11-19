// The Postgres database, through Kysely. Columns are camelCase, like Better
// Auth's, so names are the same in SQL and TypeScript.

import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely'
import pg from 'pg'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
// jsonb columns are read as parsed JSON but written as JSON text, since pg
// would otherwise send JS arrays as Postgres arrays.
type Json<T> = ColumnType<T, string, string>

export const CHANGE_REQUEST_STATUSES = ['draft', 'submitted', 'stale', 'approved', 'rejected', 'withdrawn'] as const
export type ChangeRequestStatus = typeof CHANGE_REQUEST_STATUSES[number]

export interface Database {
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
        status: Generated<ChangeRequestStatus>
        title: Generated<string>
        ops: Json<unknown[]>
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
