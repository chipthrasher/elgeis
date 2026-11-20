// The layers git repo and the static JSON built from it. The backend is the
// only thing that writes either.
//
// On a fresh install the repo volume is empty, so the repo starts as a clone
// of the remote (LAYERS_REMOTE). Each approved change request becomes one
// commit, which is built and then pushed back to the remote.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { formatJson } from '../shared/format.ts'
import type { LayerData } from '../shared/layer.ts'
import { buildLayers } from '../scripts/build-layers.ts'

const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Elgeis Map', '-c', 'user.email=map@localhost', ...args], { cwd: dir, stdio: 'pipe', encoding: 'utf8' })

export interface Commit {
    // The layers to write, as they should be after the commit.
    layers: LayerData[]
    // The IDs of the objects to write (or delete, when they're no longer in
    // their layer), by layer.
    changed: Map<string, string[]>
    author: { name: string, email: string }
    message: string
}

export class LayersRepo {
    readonly dir: string
    readonly buildDir: string
    // Every layer, including hidden objects, as of the last commit.
    data: LayerData[]

    constructor(dir: string, buildDir: string, remote: string) {
        if (!fs.existsSync(path.join(dir, '.git'))) {
            fs.mkdirSync(dir, { recursive: true })
            git(dir, 'clone', '--quiet', remote, '.')
        }
        this.dir = dir
        this.buildDir = buildDir
        this.data = buildLayers(dir, buildDir)
    }

    // Write the changed objects, commit, and rebuild. Undoes the commit if the
    // build fails. Returns the commit's hash.
    commit({ layers, changed, author, message }: Commit): string {
        const head = git(this.dir, 'rev-parse', 'HEAD').trim()
        try {
            for (const [layerId, ids] of changed) {
                const objects = new Map(layers.find(l => l.layer.id === layerId)!.objects.map(o => [o.id, o]))
                for (const id of ids) {
                    const file = path.join(this.dir, layerId, id + '.json')
                    const object = objects.get(id)
                    if (object) fs.writeFileSync(file, formatJson(object))
                    else fs.rmSync(file, { force: true })
                }
                git(this.dir, 'add', '--all', '--', layerId)
            }
            git(this.dir, 'commit', '--quiet', `--author=${author.name} <${author.email}>`, `--message=${message}`)
            this.data = buildLayers(this.dir, this.buildDir)
        } catch (e) {
            git(this.dir, 'reset', '--quiet', '--hard', head)
            throw e
        }
        return git(this.dir, 'rev-parse', 'HEAD').trim()
    }

    // Push to the remote. A failed push is retried with the next commit, so
    // it's only logged.
    push() {
        try {
            git(this.dir, 'push', '--quiet', 'origin', 'HEAD')
        } catch (e) {
            console.error('Pushing the layers repo failed:', (e as { stderr?: string }).stderr || (e as Error).message)
        }
    }

    // The messages of the last `count` commits, newest first.
    recentCommits(count: number): { hash: string, message: string }[] {
        return git(this.dir, 'log', `-${count}`, '--format=%H%n%B%x00')
            .split('\0').map(s => s.trim()).filter(Boolean)
            .map(s => ({ hash: s.slice(0, s.indexOf('\n')), message: s.slice(s.indexOf('\n') + 1) }))
    }
}
