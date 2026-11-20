// A layers repo for tests, cloned from a stand-in remote with a small
// political layer: one nation (ent_a) with one polygon (pol_a).

import { after } from 'node:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatJson } from '../shared/format.ts'
import type { LayerObject } from '../shared/layer.ts'
import { LayersRepo } from './layers.ts'

export const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

export const MANIFEST = {
    id: 'political', name: 'Political', dimension: 'overworld', titleField: 'name',
    fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'entities', label: 'Political entities', type: 'entities' },
    ],
}
export const NATION: LayerObject = { type: 'Feature', id: 'ent_a', geometry: null, properties: { name: 'Adfelis', color: '#ff0000' } }
export const POLYGON: LayerObject = {
    type: 'Feature', id: 'pol_a',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
    properties: { entities: ['Adfelis'] },
}

export function testRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
    after(() => fs.rmSync(tmp, { recursive: true }))

    const remote = path.join(tmp, 'remote')
    fs.mkdirSync(path.join(remote, 'political'), { recursive: true })
    for (const o of [MANIFEST, NATION, POLYGON]) {
        fs.writeFileSync(path.join(remote, 'political', (o.id === 'political' ? 'layer' : o.id) + '.json'), formatJson(o))
    }
    git(remote, 'init', '--quiet', '--initial-branch=main')
    git(remote, 'add', '--all')
    git(remote, '-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '--quiet', '--message=From the remote')
    // Let the clone push to the checked-out branch.
    git(remote, 'config', 'receive.denyCurrentBranch', 'updateInstead')

    const dir = path.join(tmp, 'repo')
    const build = path.join(tmp, 'build')
    fs.mkdirSync(dir) // like an empty volume
    return { tmp, remote, dir, build, repo: new LayersRepo(dir, build, remote) }
}
