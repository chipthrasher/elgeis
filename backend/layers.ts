// The layers git repo and the static JSON built from it. The backend is the
// only thing that writes either.
//
// On a fresh install the repo volume is empty. With a remote (LAYERS_REMOTE),
// the repo starts as a clone of it; without one, as a copy of the sample layer
// data bundled with the code, which is handy for development.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildLayers } from '../scripts/build-layers.ts'

function git(dir: string, ...args: string[]) {
    try {
        execFileSync('git', ['-c', 'user.name=Elgeis Map', '-c', 'user.email=map@localhost', ...args], { cwd: dir, stdio: 'pipe' })
    } catch (e) {
        // Only git's own output, and not the original error as the cause: the
        // command line can hold a token in the remote URL.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`git ${args[0]} failed: ${(e as { stderr?: Buffer }).stderr}`)
    }
}

export function initLayers(repoDir: string, bundledDir: string, buildDir: string, remote?: string) {
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
        fs.mkdirSync(repoDir, { recursive: true })
        if (remote) {
            git(repoDir, 'clone', '--quiet', remote, '.')
        } else {
            fs.cpSync(bundledDir, repoDir, { recursive: true })
            git(repoDir, 'init', '--quiet', '--initial-branch=main')
            git(repoDir, 'add', '--all')
            git(repoDir, 'commit', '--quiet', '--message=Import the bundled layers')
        }
    }
    return buildLayers(repoDir, buildDir)
}
