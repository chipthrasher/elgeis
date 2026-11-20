// The layers git repo and the static JSON built from it. The backend is the
// only thing that writes either.
//
// On a fresh install the repo volume is empty, so the repo starts as a clone
// of the remote (LAYERS_REMOTE).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildLayers } from '../scripts/build-layers.ts'

const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Elgeis Map', '-c', 'user.email=map@localhost', ...args], { cwd: dir, stdio: 'pipe' })

export function initLayers(repoDir: string, buildDir: string, remote: string) {
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
        fs.mkdirSync(repoDir, { recursive: true })
        git(repoDir, 'clone', '--quiet', remote, '.')
    }
    return buildLayers(repoDir, buildDir)
}
