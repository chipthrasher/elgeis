// Layers: reading them with their hidden objects, creating community layers,
// and running them. Any account can create a layer, and becomes its first
// admin. A layer's admins edit its name and schema and choose its other
// admins. Site admins can do all that on any layer, and decide which layers
// are official (shown by default), and hide or delete community layers.
//
// Manifests live in the layers repo, so editing one is a commit, made one at a
// time like approvals. Whether a layer is hidden, who made it, and who its
// admins are live in Postgres.

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { DIMENSIONS, Field, Layer, newId, type LayerObject } from '../shared/layer.ts'
import type { Db } from './db.ts'
import { fail, isLayerAdmin, isSiteAdmin, parseBody, signedIn, siteAdmin, type Env } from './http.ts'
import type { LayersRepo } from './layers.ts'
import { authorOf, type Deps } from './requests.ts'

// Layer names end up in commit messages, so they're one line.
const Name = z.string().trim().min(1).max(100).regex(/^[^\p{Cc}]*$/u, 'A name has to be one line, without special characters')
const Description = z.string().trim().max(500).optional()

// What a layer's admins can change. Its ID and dimension are fixed, and only
// site admins decide whether it's official.
const LayerEdit = z.object({
    name: Name,
    description: Description,
    titleField: z.string(),
    labelField: z.string().optional(),
    hoverLines: z.boolean().optional(),
    defaultColor: z.string().optional(),
    fields: z.array(Field).max(50),
}).strict()

const NewLayer = z.object({ name: Name, description: Description, dimension: z.enum(DIMENSIONS) }).strict()

// What a new layer's objects start out with. Areas are drawn in their Color
// (see ObjectIndex.colors), or grey without one.
const STARTING_FIELDS: Field[] = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'color', label: 'Color', type: 'color', description: 'What color it is on the map' },
]

// Leave out of the map's static JSON, and so the community layer list, the
// layers a site admin has hidden, and the community layers of banned accounts.
export async function hideLayers(db: Db, repo: LayersRepo) {
    const rows = await db.selectFrom('layer').leftJoin('user', 'user.id', 'layer.createdBy').select('layer.id')
        .where(eb => eb.or([eb('layer.hidden', '=', true), eb('user.banned', '=', true)])).execute()
    const official = new Set(repo.data.filter(l => l.layer.official).map(l => l.layer.id))
    repo.hidden = new Set(rows.map(r => r.id).filter(id => !official.has(id)))
    repo.rebuild()
}

export function layerRoutes({ db, repo, siteUrl, serially }: Deps, { markStale, catchUp }: { markStale: () => Promise<void>, catchUp: () => Promise<void> }) {
    const app = new Hono<Env>()

    const find = (layerId: string) => {
        const data = repo.data.find(l => l.layer.id === layerId)
        if (!data) throw fail(404, 'No such layer')
        return data
    }

    // The layer in the URL, if the current user is one of its admins.
    async function administered(c: Context<Env>) {
        const user = signedIn(c)
        const data = find(c.req.param('id')!)
        if (!await isLayerAdmin(db, user, data.layer.id)) throw fail(403, "You're not an admin of this layer")
        return { user, data }
    }

    // A community layer, for a site admin.
    function moderated(c: Context<Env>) {
        const user = siteAdmin(c)
        const data = find(c.req.param('id')!)
        if (data.layer.official) throw fail(409, 'Official layers can\'t be hidden or deleted. Make it a community layer first.')
        return { user, data }
    }

    // Commit a layer's manifest, from the latest in the remote, and push it.
    async function save(userId: string, layer: Layer, objects: LayerObject[], message: string) {
        await catchUp()
        try {
            repo.writeLayer(layer, objects, await authorOf(db, siteUrl, userId), message)
        } catch (e) {
            throw fail(400, (e as Error).message)
        }
        await markStale()
        repo.push()
    }

    const adminList = async (layerId: string) => (await db.selectFrom('layerAdmin')
        .innerJoin('user', 'user.id', 'layerAdmin.userId')
        .select(['user.username', 'user.displayUsername'])
        .where('layerId', '=', layerId).orderBy('layerAdmin.createdAt').execute())
        .map(u => u.displayUsername ?? u.username)

    /* Reading */

    // Every layer, with what the map's static JSON doesn't say: who made it,
    // who its admins are, and whether a site admin has hidden it. Hidden
    // layers, and those of banned accounts, are only listed for site admins.
    app.get('/layers', async c => {
        const user = c.get('user')
        const rows = await db.selectFrom('layer').leftJoin('user', 'user.id', 'layer.createdBy')
            .select(['layer.id', 'layer.hidden', 'user.username as createdBy', 'user.banned as creatorBanned']).execute()
        const admins = await db.selectFrom('layerAdmin').innerJoin('user', 'user.id', 'layerAdmin.userId')
            .select(['layerId', 'userId', 'user.username', 'user.displayUsername']).orderBy('layerAdmin.createdAt').execute()
        const adminsOf = (layerId: string) => admins.filter(a => a.layerId === layerId)
        return c.json(repo.data.flatMap(({ layer }) => {
            const row = rows.find(r => r.id === layer.id)
            if (repo.hidden.has(layer.id) && !isSiteAdmin(user)) return []
            return [{
                ...layer,
                hidden: !!row?.hidden,
                createdBy: row?.createdBy ?? null,
                creatorBanned: !!row?.creatorBanned,
                admins: adminsOf(layer.id).map(a => a.displayUsername ?? a.username),
                canAdmin: isSiteAdmin(user) || adminsOf(layer.id).some(a => a.userId === user?.id),
            }]
        }))
    })

    // A layer with its hidden objects, for the editor.
    app.get('/layers/:id', async c => {
        const data = find(c.req.param('id'))
        return c.json({ ...data, canReview: await isLayerAdmin(db, c.get('user'), data.layer.id) })
    })

    /* Creating */

    app.post('/layers', async c => {
        const user = signedIn(c)
        const body = await parseBody(c, NewLayer)
        const layer: Layer = { id: newId('lay'), ...body, description: body.description || undefined, titleField: 'name', fields: STARTING_FIELDS }
        await serially(async () => {
            await save(user.id, layer, [], `Create the ${layer.name} layer\n\nCreated by ${user.username}.\n`)
            await db.insertInto('layer').values({ id: layer.id, createdBy: user.id }).onConflict(oc => oc.doNothing()).execute()
            await db.insertInto('layerAdmin').values({ layerId: layer.id, userId: user.id }).execute()
        })
        return c.json(layer, 201)
    })

    /* Layer admins: the schema, and other admins */

    // Fields dropped from the schema are dropped from the layer's objects too.
    // Changing a field's type is refused if objects have values that don't fit.
    app.put('/layers/:id', async c => {
        const { user } = await administered(c)
        const edit = await parseBody(c, LayerEdit)
        await serially(async () => {
            const { layer, objects } = find(c.req.param('id'))
            const result = Layer.safeParse({ ...layer, ...edit, description: edit.description || undefined, labelField: edit.labelField || undefined, hoverLines: edit.hoverLines || undefined, defaultColor: edit.defaultColor || undefined })
            if (!result.success) throw fail(400, z.prettifyError(result.error))
            const keys = new Set(['hidden', ...result.data.fields.map(f => f.key)])
            const trimmed = objects.flatMap(o => Object.keys(o.properties).some(k => !keys.has(k))
                ? [{ ...o, properties: Object.fromEntries(Object.entries(o.properties).filter(([k]) => keys.has(k))) }]
                : [])
            await save(user.id, result.data, trimmed, `Update the ${result.data.name} layer's schema\n\nChanged by ${user.username}.\n`)
        })
        return c.json(find(c.req.param('id')).layer)
    })

    app.get('/layers/:id/admins', async c => c.json(await adminList(find(c.req.param('id')).layer.id)))

    app.post('/layers/:id/admins', async c => {
        const { data } = await administered(c)
        const { username } = await parseBody(c, z.object({ username: z.string().trim().min(1) }).strict())
        const user = await db.selectFrom('user').select('id').where('username', '=', username.toLowerCase()).executeTakeFirst()
        if (!user) throw fail(404, `Nobody has the username "${username}"`)
        await db.insertInto('layerAdmin').values({ layerId: data.layer.id, userId: user.id }).onConflict(oc => oc.doNothing()).execute()
        return c.json(await adminList(data.layer.id))
    })

    // A layer always keeps at least one admin, unless a site admin says so.
    app.delete('/layers/:id/admins/:username', async c => {
        const { user, data } = await administered(c)
        const admins = await db.selectFrom('layerAdmin').innerJoin('user', 'user.id', 'layerAdmin.userId')
            .select(['user.id', 'user.username']).where('layerId', '=', data.layer.id).execute()
        const removed = admins.find(a => a.username === c.req.param('username').toLowerCase())
        if (!removed) throw fail(404, "They're not an admin of this layer")
        if (admins.length === 1 && !isSiteAdmin(user)) throw fail(409, 'A layer needs at least one admin. Add another first.')
        await db.deleteFrom('layerAdmin').where('layerId', '=', data.layer.id).where('userId', '=', removed.id).execute()
        return c.json(await adminList(data.layer.id))
    })

    /* Site admins: official layers, and hiding and deleting community layers */

    app.post('/layers/:id/official', async c => {
        const user = siteAdmin(c)
        const { official } = await parseBody(c, z.object({ official: z.boolean() }).strict())
        await serially(async () => {
            const { layer } = find(c.req.param('id'))
            if (official && repo.hidden.has(layer.id)) throw fail(409, 'Show the layer before making it official')
            if (!!layer.official === official) return
            await save(user.id, { ...layer, official: official || undefined }, [],
                `${official ? 'Make' : 'Stop making'} the ${layer.name} layer official\n\nChanged by ${user.username}.\n`)
            // A banned account's layer is hidden once it's a community layer.
            if (!official) await hideLayers(db, repo)
        })
        return c.json(find(c.req.param('id')).layer)
    })

    // Hidden layers are left out of the map's static JSON, and so out of the
    // community layer list, until they're shown again.
    app.post('/layers/:id/hidden', async c => {
        const { data } = moderated(c)
        const { hidden } = await parseBody(c, z.object({ hidden: z.boolean() }).strict())
        await serially(async () => {
            await db.updateTable('layer').set({ hidden }).where('id', '=', data.layer.id).execute()
            await hideLayers(db, repo)
        })
        return c.json({ hidden })
    })

    // Deletes the layer's folder, along with its change requests. Refused if
    // another layer still points at its objects.
    app.delete('/layers/:id', async c => {
        const { user, data } = moderated(c)
        const { id, name } = data.layer
        await serially(async () => {
            await catchUp()
            try {
                repo.deleteLayer(id, await authorOf(db, siteUrl, user.id), `Delete the ${name} layer\n\nDeleted by ${user.username}.\n`)
            } catch (e) {
                throw fail(409, (e as Error).message)
            }
            await db.deleteFrom('layer').where('id', '=', id).execute()
            repo.hidden.delete(id)
            repo.push()
        })
        return c.json({ deleted: id })
    })

    return app
}
