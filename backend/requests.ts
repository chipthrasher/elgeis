// Change requests: drafting, submitting, reviewing, and approving them.
//
// Anyone signed in (and not banned) can make change requests, up to
// MAX_OPEN_REQUESTS open at once. A layer's admins, and site admins, review
// them. Approvals run one at a time: each applies its ops to the layers repo,
// commits, rebuilds the static JSON, marks the request approved, and pushes.

import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { checkOps, MAX_OPEN_REQUESTS, OPEN_STATUSES, opId, RequestBody, type Op, type Status } from '../shared/changes.ts'
import type { Auth } from './auth.ts'
import type { Db } from './db.ts'
import type { LayersRepo } from './layers.ts'

export interface User {
    id: string
    username: string
    role: string | null
}

type Env = { Variables: { user: User | null } }

const fail = (status: 400 | 401 | 403 | 404 | 409, message: string) => new HTTPException(status, { message })

// The ID of the request a commit was made for, and who approved it, are kept
// as trailers at the end of its message.
const TRAILER = /^Change-Request: (\d+)$/m
const APPROVER = /^Approved-By: (.+)$/m

export function requestRoutes(db: Db, auth: Auth, repo: LayersRepo, siteUrl: string) {
    const app = new Hono<Env>()

    app.use(async (c, next) => {
        const session = await auth.api.getSession({ headers: c.req.raw.headers })
        const u = session?.user as { id: string, username?: string | null, role?: string | null, banned?: boolean | null } | undefined
        c.set('user', u?.username && !u.banned ? { id: u.id, username: u.username, role: u.role ?? null } : null)
        await next()
    })

    const signedIn = (c: Context<Env>) => {
        const user = c.get('user')
        if (!user) throw fail(401, 'Sign in and pick a username first')
        return user
    }

    async function canReview(user: User | null, layerId: string) {
        if (!user) return false
        if (user.role === 'admin') return true
        return !!await db.selectFrom('layerAdmin').select('userId').where('layerId', '=', layerId).where('userId', '=', user.id).executeTakeFirst()
    }

    const parseBody = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
        const result = schema.safeParse(await c.req.json().catch(() => null))
        if (!result.success) throw fail(400, z.prettifyError(result.error))
        return result.data
    }

    // Throw if the ops aren't valid against the layers as they are now.
    function check(layerId: string, ops: Op[]) {
        const { errors } = checkOps(repo.data, layerId, ops)
        if (errors.length) throw fail(400, errors.join('\n'))
    }

    const usernames = db.selectFrom('user').select(['id', 'username'])

    async function load(id: number) {
        const request = await db.selectFrom('changeRequest').selectAll().where('id', '=', id).executeTakeFirst()
        if (!request) throw fail(404, 'No such change request')
        return request
    }
    type Request = Awaited<ReturnType<typeof load>>

    // What the browser sees of a request.
    async function present(r: Request, user: User | null, full: boolean) {
        const ids = [r.authorId, r.reviewedBy].filter((x): x is string => !!x)
        const comments = full
            ? await db.selectFrom('comment').selectAll().where('changeRequestId', '=', r.id).orderBy('id').execute()
            : []
        ids.push(...comments.map(cm => cm.authorId))
        const names = new Map((await usernames.where('id', 'in', ids).execute()).map(u => [u.id, u.username]))
        return {
            id: r.id,
            layerId: r.layerId,
            title: r.title,
            status: r.status,
            ops: r.ops,
            author: names.get(r.authorId) ?? null,
            mine: r.authorId === user?.id,
            canReview: await canReview(user, r.layerId),
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            submittedAt: r.submittedAt,
            reviewedBy: r.reviewedBy && (names.get(r.reviewedBy) ?? null),
            reviewedAt: r.reviewedAt,
            commit: r.commit,
            comments: comments.map(cm => ({ author: names.get(cm.authorId) ?? null, body: cm.body, createdAt: cm.createdAt })),
        }
    }

    // Load a request the current user wrote and can still change.
    async function ownOpen(c: Context<Env>) {
        const user = signedIn(c)
        const request = await load(Number(c.req.param('id')))
        if (request.authorId !== user.id) throw fail(403, "That's someone else's change request")
        if (!OPEN_STATUSES.includes(request.status)) throw fail(409, `This change request is already ${request.status}`)
        return { user, request }
    }

    // Load a submitted request the current user can review.
    async function reviewable(c: Context<Env>) {
        const user = signedIn(c)
        const request = await load(Number(c.req.param('id')))
        if (!await canReview(user, request.layerId)) throw fail(403, "You can't review change requests for this layer")
        if (request.status !== 'submitted') throw fail(409, `This change request is ${request.status}, not submitted`)
        return { user, request }
    }

    async function setStatus(id: number, status: Status, extra: object = {}) {
        await db.updateTable('changeRequest').set({ status, updatedAt: new Date(), ...extra }).where('id', '=', id).execute()
    }

    async function addComment(id: number, authorId: string, body: string | undefined) {
        if (body?.trim()) await db.insertInto('comment').values({ changeRequestId: id, authorId, body: body.trim() }).execute()
    }

    /* Layers, with hidden objects, for the editor */

    app.get('/layers/:id', async c => {
        const data = repo.data.find(l => l.layer.id === c.req.param('id'))
        if (!data) throw fail(404, 'No such layer')
        return c.json({ ...data, canReview: await canReview(c.get('user'), data.layer.id) })
    })

    /* Listing and reading */

    // ?mine lists your own requests; ?review lists submitted requests on the
    // layers you review.
    app.get('/requests', async c => {
        const user = signedIn(c)
        let query = db.selectFrom('changeRequest').selectAll().orderBy('updatedAt', 'desc').limit(100)
        if (c.req.query('review') !== undefined) {
            query = query.where('status', '=', 'submitted')
            if (user.role !== 'admin') {
                query = query.where('layerId', 'in', db.selectFrom('layerAdmin').select('layerId').where('userId', '=', user.id))
            }
        } else {
            query = query.where('authorId', '=', user.id)
        }
        const requests = await query.execute()
        return c.json(await Promise.all(requests.map(r => present(r, user, false))))
    })

    // Drafts are private to their author and reviewers; the rest are public.
    app.get('/requests/:id', async c => {
        const user = c.get('user')
        const request = await load(Number(c.req.param('id')))
        if (request.status === 'draft' && request.authorId !== user?.id && !await canReview(user, request.layerId)) {
            throw fail(404, 'No such change request')
        }
        return c.json(await present(request, user, true))
    })

    /* Drafting */

    app.post('/requests', async c => {
        const user = signedIn(c)
        const body = await parseBody(c, RequestBody.extend({ layerId: z.string() }))
        if (!repo.data.some(l => l.layer.id === body.layerId)) throw fail(400, `No layer "${body.layerId}"`)
        check(body.layerId, body.ops)
        const open = await db.selectFrom('changeRequest').select(db.fn.countAll<string>().as('n'))
            .where('authorId', '=', user.id).where('status', 'in', OPEN_STATUSES).executeTakeFirstOrThrow()
        if (Number(open.n) >= MAX_OPEN_REQUESTS) {
            throw fail(409, `You can have at most ${MAX_OPEN_REQUESTS} open change requests. Withdraw one, or wait for one to be reviewed.`)
        }
        const request = await db.insertInto('changeRequest')
            .values({ layerId: body.layerId, authorId: user.id, title: body.title, ops: JSON.stringify(body.ops) })
            .returningAll().executeTakeFirstOrThrow()
        return c.json(await present(request, user, true), 201)
    })

    // Editing a request makes it a draft again, to be submitted once it's ready.
    app.put('/requests/:id', async c => {
        const { user, request } = await ownOpen(c)
        const body = await parseBody(c, RequestBody)
        check(request.layerId, body.ops)
        await setStatus(request.id, 'draft', { title: body.title, ops: JSON.stringify(body.ops), submittedAt: null })
        return c.json(await present(await load(request.id), user, true))
    })

    app.post('/requests/:id/submit', async c => {
        const { user, request } = await ownOpen(c)
        check(request.layerId, request.ops)
        if (!request.title) throw fail(400, 'Give your change request a title first')
        await setStatus(request.id, 'submitted', { submittedAt: new Date() })
        return c.json(await present(await load(request.id), user, true))
    })

    app.post('/requests/:id/withdraw', async c => {
        const { user, request } = await ownOpen(c)
        await setStatus(request.id, 'withdrawn')
        return c.json(await present(await load(request.id), user, true))
    })

    /* Reviewing */

    const Review = z.object({ comment: z.string().max(5000).optional() }).strict()

    app.post('/requests/:id/comments', async c => {
        const user = signedIn(c)
        const request = await load(Number(c.req.param('id')))
        if (request.authorId !== user.id && !await canReview(user, request.layerId)) throw fail(403, 'Only the author and reviewers can comment')
        const { body } = await parseBody(c, z.object({ body: z.string().trim().min(1).max(5000) }).strict())
        await addComment(request.id, user.id, body)
        return c.json(await present(request, user, true))
    })

    app.post('/requests/:id/reject', async c => {
        const { user, request } = await reviewable(c)
        const { comment } = await parseBody(c, Review)
        await addComment(request.id, user.id, comment)
        await setStatus(request.id, 'rejected', { reviewedBy: user.id, reviewedAt: new Date() })
        return c.json(await present(await load(request.id), user, true))
    })

    app.post('/requests/:id/approve', async c => {
        const { comment } = await parseBody(c, Review)
        const user = await serially(async () => {
            const { user, request } = await reviewable(c)
            await approve(request, user)
            await addComment(request.id, user.id, comment)
            return user
        })
        return c.json(await present(await load(Number(c.req.param('id'))), user, true))
    })

    // Approvals (and startup's reconciling) run one at a time, so two can't
    // touch the repo at once.
    let queue: Promise<unknown> = Promise.resolve()
    function serially<T>(fn: () => Promise<T>): Promise<T> {
        const run = queue.then(fn)
        queue = run.catch(() => {})
        return run
    }

    // Git first, then Postgres. If the backend dies between the two,
    // reconcile() finishes the job on the next start.
    async function approve(request: Request, reviewer: User) {
        const { ops } = request
        const result = checkOps(repo.data, request.layerId, ops)
        if (result.stale.length) {
            await setStatus(request.id, 'stale')
            throw fail(409, 'Something this change request changes has changed since, so it needs updating by its author')
        }
        if (result.errors.length) throw fail(400, result.errors.join('\n'))

        const author = await db.selectFrom('user').select(['username', 'displayUsername']).where('id', '=', request.authorId).executeTakeFirstOrThrow()
        const commit = repo.commit({
            layers: result.layers,
            changed: new Map([[request.layerId, ops.map(opId)]]),
            // The repo is public, so authors get a stand-in address rather
            // than their real one.
            author: { name: author.displayUsername ?? author.username!, email: `${author.username}@users.noreply.${new URL(siteUrl).hostname}` },
            message: `${request.title || 'Change request'}\n\nApproved by ${reviewer.username}.\n\nChange-Request: ${request.id}\nApproved-By: ${reviewer.username}\n`,
        })
        await setStatus(request.id, 'approved', { reviewedBy: reviewer.id, reviewedAt: new Date(), commit })
        await markStale()
        repo.push()
    }

    // Mark open requests stale when what they change has changed since.
    async function markStale() {
        const open = await db.selectFrom('changeRequest').select(['id', 'layerId', 'ops'])
            .where('status', 'in', ['draft', 'submitted']).execute()
        const stale = open.filter(r => checkOps(repo.data, r.layerId, r.ops).stale.length).map(r => r.id)
        if (stale.length) await db.updateTable('changeRequest').set({ status: 'stale', updatedAt: new Date() }).where('id', 'in', stale).execute()
    }

    // Mark requests that were committed but never marked approved, which
    // happens if the backend stops between the two.
    async function reconcile() {
        await serially(async () => {
            for (const { hash, message } of repo.recentCommits(50)) {
                const id = message.match(TRAILER)?.[1]
                if (!id) continue
                const request = await db.selectFrom('changeRequest').select('status').where('id', '=', Number(id)).executeTakeFirst() // eslint-disable-line no-await-in-loop
                if (!request || request.status === 'approved') continue
                const reviewer = await db.selectFrom('user').select('id').where('username', '=', message.match(APPROVER)?.[1] ?? '').executeTakeFirst() // eslint-disable-line no-await-in-loop
                await setStatus(Number(id), 'approved', { reviewedBy: reviewer?.id ?? null, reviewedAt: new Date(), commit: hash }) // eslint-disable-line no-await-in-loop
                console.log(`Marked change request ${id} approved, from commit ${hash}`)
            }
            await markStale()
            repo.push()
        })
    }

    return { app, reconcile }
}
