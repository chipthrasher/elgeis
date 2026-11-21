// Change requests: drafting, submitting, reviewing, and approving them.
//
// Anyone signed in (and not banned) can make change requests, up to
// MAX_OPEN_REQUESTS open at once. A layer's admins, and site admins, review
// them. Approvals run one at a time: each applies its ops to the layers repo,
// commits, rebuilds the static JSON, marks the request approved, and pushes.
// Reviewers hear about submitted requests by email, and authors about their
// requests being approved, rejected, or going stale.

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { checkOps, MAX_OPEN_REQUESTS, OPEN_STATUSES, opId, RequestBody, type Op, type Status } from '../shared/changes.ts'
import { USERNAME_CHARS } from './auth.ts'
import type { Db } from './db.ts'
import { fail, isLayerAdmin, parseBody, signedIn, type Env, type Serially, type User } from './http.ts'
import type { Author, LayersRepo } from './layers.ts'
import { notify } from './notify.ts'
import type { LayerObject } from '../shared/layer.ts'

// The ID of the request a commit was made for, and who approved it, are kept
// as trailers at the end of its message.
// A display name that's safe as a commit author (older ones weren't checked).
const safeName = (name: string | null) => name && USERNAME_CHARS.test(name) ? name : null

// Trailers end a message, so they're read from the end, past anything the
// title might hold.
const trailer = (message: string, key: string) =>
    message.trim().split('\n').reverse().find(line => line.startsWith(key + ': '))?.slice(key.length + 2)

export interface Deps {
    db: Db
    repo: LayersRepo
    siteUrl: string
    serially: Serially
}

// A commit author for a user. The repo is public, so authors get a stand-in
// address rather than their real one.
export async function authorOf(db: Db, siteUrl: string, userId: string): Promise<Author> {
    const user = await db.selectFrom('user').select(['username', 'displayUsername']).where('id', '=', userId).executeTakeFirstOrThrow()
    return { name: safeName(user.displayUsername) ?? user.username!, email: `${user.username}@users.noreply.${new URL(siteUrl).hostname}` }
}

export function requestRoutes({ db, repo, siteUrl, serially }: Deps) {
    const app = new Hono<Env>()
    const canReview = (user: User | null, layerId: string) => isLayerAdmin(db, user, layerId)
    const link = (id: number) => `${siteUrl}/?request=${id}`
    const layerName = (layerId: string) => repo.data.find(l => l.layer.id === layerId)?.layer.name ?? layerId

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
            // For an open request whose objects have changed since, those
            // objects as they were when it was made, so it can be merged.
            bases: full && OPEN_STATUSES.includes(r.status) ? bases(r) : {},
            comments: comments.map(cm => ({ author: names.get(cm.authorId) ?? null, body: cm.body, createdAt: cm.createdAt })),
        }
    }

    function bases(r: Request): Record<string, LayerObject | null> {
        const stale = new Set(checkOps(repo.data, r.layerId, r.ops).stale)
        return Object.fromEntries(r.ops.flatMap(op => op.op !== 'add' && stale.has(opId(op))
            ? [[opId(op), repo.findVersion(r.layerId, opId(op), op.baseVersion)]]
            : []))
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

    // Tell a request's author what happened to it.
    async function tellAuthor(r: Request, subject: string, text: string) {
        await notify(db, [r.authorId], subject, `${text}\n\n${link(r.id)}\n`)
    }

    // Tell a layer's admins there's a request to review, or the site admins
    // if it has none.
    async function askReviewers(r: Request, author: string) {
        const admins = await db.selectFrom('layerAdmin').select('userId').where('layerId', '=', r.layerId).execute()
        const reviewers = admins.length ? admins : await db.selectFrom('user').select('id as userId').where('role', '=', 'admin').execute()
        await notify(db, reviewers.map(a => a.userId).filter(id => id !== r.authorId), `Review "${r.title}" on the Elgeis Map`,
            `${author} asks you to review their change request "${r.title}" to ${layerName(r.layerId)}:\n\n${link(r.id)}\n`)
    }

    /* Listing and reading */

    // ?mine lists your own requests; ?review lists submitted requests on the
    // layers you review, and those waiting on their authors to update them.
    app.get('/requests', async c => {
        const user = signedIn(c)
        let query = db.selectFrom('changeRequest').selectAll().orderBy('updatedAt', 'desc').limit(100)
        if (c.req.query('review') !== undefined) {
            query = query.where(eb => eb.or([
                eb('status', '=', 'submitted'),
                eb.and([eb('status', '=', 'stale'), eb('submittedAt', 'is not', null)]),
            ]))
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
        await askReviewers(request, user.username)
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
        await tellAuthor(request, `Your change "${request.title}" wasn't approved`,
            `${user.username} didn't approve your change request "${request.title}" to ${layerName(request.layerId)}.` + (comment?.trim() ? `\n\nThey said: ${comment.trim()}` : ''))
        return c.json(await present(await load(request.id), user, true))
    })

    app.post('/requests/:id/approve', async c => {
        const { comment } = await parseBody(c, Review)
        const user = await serially(async () => {
            const { user, request } = await reviewable(c)
            await approve(request, user)
            await addComment(request.id, user.id, comment)
            await tellAuthor(request, `Your change "${request.title}" is on the map`,
                `${user.username} approved your change request "${request.title}" to ${layerName(request.layerId)}.` + (comment?.trim() ? `\n\nThey said: ${comment.trim()}` : ''))
            return user
        })
        return c.json(await present(await load(Number(c.req.param('id'))), user, true))
    })

    // Git first, then Postgres. If the backend dies between the two,
    // reconcile() finishes the job on the next start.
    async function approve(request: Request, reviewer: User) {
        const { ops } = request
        await catchUp()
        const result = checkOps(repo.data, request.layerId, ops)
        if (result.stale.length) {
            await markStale([request])
            throw fail(409, 'Something this change request changes has changed since, so it needs updating by its author')
        }
        if (result.errors.length) throw fail(400, result.errors.join('\n'))

        const commit = repo.commit({
            layers: result.layers,
            changed: new Map([[request.layerId, ops.map(opId)]]),
            author: await authorOf(db, siteUrl, request.authorId),
            message: `${request.title.replace(/\s+/g, ' ').trim() || 'Change request'}\n\nApproved by ${reviewer.username}.\n\nChange-Request: ${request.id}\nApproved-By: ${reviewer.username}\n`,
        })
        await setStatus(request.id, 'approved', { reviewedBy: reviewer.id, reviewedAt: new Date(), commit })
        await markStale()
        repo.push()
    }

    // Mark open requests stale when what they change has changed since (or
    // these, which have), and tell their authors.
    async function markStale(requests?: Request[]) {
        const open = requests ?? await db.selectFrom('changeRequest').selectAll().where('status', 'in', ['draft', 'submitted']).execute()
        const stale = open.filter(r => checkOps(repo.data, r.layerId, r.ops).stale.length)
        if (!stale.length) return
        await db.updateTable('changeRequest').set({ status: 'stale', updatedAt: new Date() }).where('id', 'in', stale.map(r => r.id)).execute()
        for (const r of stale) {
            await tellAuthor(r, `Your change "${r.title || 'Untitled'}" needs updating`, // eslint-disable-line no-await-in-loop
                `Something your change request "${r.title || 'Untitled'}" changes on ${layerName(r.layerId)} has been changed since. ` +
                `Open it to update it, keeping what you want from each.`)
        }
    }

    // Pull in the remote's latest before committing, so a commit doesn't
    // undo or fork from edits made there. Refuses if they can't be pulled in.
    async function catchUp() {
        try {
            if (repo.sync()) await markStale()
        } catch (e) {
            throw fail(409, (e as Error).message)
        }
        await addLayerRows()
    }

    // Every layer in the repo gets a row, for its admins and change requests.
    async function addLayerRows() {
        if (repo.data.length) await db.insertInto('layer').values(repo.data.map(l => ({ id: l.layer.id }))).onConflict(c => c.doNothing()).execute()
    }

    // Catch up with the repo: pull in edits made to the remote, and mark
    // requests that were committed but never marked approved, which happens
    // if the backend stops between the two. Runs at startup and every few
    // minutes.
    async function reconcile() {
        await serially(async () => {
            try {
                repo.sync()
            } catch (e) {
                console.error((e as Error).message)
            }
            await addLayerRows()
            for (const { hash, message } of repo.recentCommits(50)) {
                const id = trailer(message, 'Change-Request')
                if (!id || !/^\d+$/.test(id)) continue
                const request = await db.selectFrom('changeRequest').select(['status', 'commit']).where('id', '=', Number(id)).executeTakeFirst() // eslint-disable-line no-await-in-loop
                if (!request) continue
                // Pulling in the remote's edits moves our unpushed commits.
                if (request.status === 'approved') {
                    if (request.commit !== hash) await db.updateTable('changeRequest').set({ commit: hash }).where('id', '=', Number(id)).execute() // eslint-disable-line no-await-in-loop
                    continue
                }
                const reviewer = await db.selectFrom('user').select('id').where('username', '=', trailer(message, 'Approved-By') ?? '').executeTakeFirst() // eslint-disable-line no-await-in-loop
                await setStatus(Number(id), 'approved', { reviewedBy: reviewer?.id ?? null, reviewedAt: new Date(), commit: hash }) // eslint-disable-line no-await-in-loop
                console.log(`Marked change request ${id} approved, from commit ${hash}`)
            }
            await markStale()
            repo.push()
        })
    }

    return { app, reconcile, markStale, catchUp }
}
