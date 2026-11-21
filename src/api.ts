// Calls to the backend's API. Errors come back as { message }.

import type { Op, Status } from '../shared/changes.ts'
import type { LayerData, LayerObject } from '../shared/layer.ts'

export async function api<T>(path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<T> {
    const response = await fetch('/api/' + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body && JSON.stringify(body),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new Error(json?.message ?? `Something went wrong (${response.status})`)
    return json
}

export interface ChangeRequest {
    id: number
    layerId: string
    title: string
    status: Status
    ops: Op[]
    author: string | null
    mine: boolean
    canReview: boolean
    updatedAt: string
    submittedAt: string | null
    reviewedBy: string | null
    commit: string | null
    // Objects that have changed since the request was made, as they were
    // when it was (null if that version can't be found).
    bases: Record<string, LayerObject | null>
    comments: { author: string | null, body: string, createdAt: string }[]
}

// A layer with its hidden objects too, which the public JSON leaves out.
export type FullLayer = LayerData & { canReview: boolean }
