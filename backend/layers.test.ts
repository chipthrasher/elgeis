import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initLayers } from './layers.ts'

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
const commits = (repo: string) => git(repo, 'log', '--format=%s').trim().split('\n')

function tmpDir(t: { after: (fn: () => void) => void }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
    t.after(() => fs.rmSync(dir, { recursive: true }))
    return dir
}

test('without a remote, initLayers starts a repo from the bundled layers once, then builds it', t => {
    const tmp = tmpDir(t)
    const repo = path.join(tmp, 'repo')
    const build = path.join(tmp, 'build')

    const layers = initLayers(repo, 'layers', build)
    assert.ok(layers.length > 0)
    assert.ok(fs.existsSync(path.join(build, 'index.json')))
    assert.deepEqual(commits(repo), ['Import the bundled layers'])

    // A second start leaves the repo alone.
    initLayers(repo, 'layers', build)
    assert.equal(commits(repo).length, 1)
})

test('with a remote, initLayers clones it into an empty repo folder', t => {
    const tmp = tmpDir(t)
    // A stand-in for the remote, with the bundled layers at its root.
    const remote = path.join(tmp, 'remote')
    fs.cpSync('layers', remote, { recursive: true })
    git(remote, 'init', '--quiet', '--initial-branch=main')
    git(remote, 'add', '--all')
    git(remote, '-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '--quiet', '--message=From the remote')

    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo) // like an empty volume
    const layers = initLayers(repo, 'no-bundled-layers', path.join(tmp, 'build'), remote)
    assert.ok(layers.length > 0)
    assert.deepEqual(commits(repo), ['From the remote'])
    assert.equal(git(repo, 'remote', 'get-url', 'origin').trim(), remote)

    assert.throws(() => initLayers(path.join(tmp, 'other'), 'layers', path.join(tmp, 'build'), path.join(tmp, 'missing')), /git clone failed/)
})
