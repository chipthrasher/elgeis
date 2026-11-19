// The layers git repo and the static JSON built from it. The backend is the
// only thing that writes either.
//
// On a fresh install the repo volume is empty, so it starts from a copy of the
// layer data bundled with the code.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildLayers } from '../scripts/build-layers.ts'

const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Elgeis Map', '-c', 'user.email=map@localhost', ...args], { cwd: dir, stdio: 'pipe' })

export function initLayers(repoDir: string, bundledDir: string, buildDir: string) {
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
        fs.cpSync(bundledDir, repoDir, { recursive: true })
        git(repoDir, 'init', '--quiet', '--initial-branch=main')
        git(repoDir, 'add', '--all')
        git(repoDir, 'commit', '--quiet', '--message=Import the bundled layers')
    }
    return buildLayers(repoDir, buildDir)
}
