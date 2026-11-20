import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initLayers } from './layers.ts'

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
const commits = (repo: string) => git(repo, 'log', '--format=%s').trim().split('\n')

test('initLayers clones the remote into an empty repo folder once, then builds it', t => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
    t.after(() => fs.rmSync(tmp, { recursive: true }))

    // A stand-in for the remote, with one empty layer.
    const remote = path.join(tmp, 'remote')
    fs.mkdirSync(path.join(remote, 'test'), { recursive: true })
    fs.writeFileSync(path.join(remote, 'test', 'layer.json'), JSON.stringify({
        id: 'test', name: 'Test', dimension: 'overworld', titleField: 'name',
        fields: [{ key: 'name', label: 'Name', type: 'text' }],
    }))
    git(remote, 'init', '--quiet', '--initial-branch=main')
    git(remote, 'add', '--all')
    git(remote, '-c', 'user.name=A', '-c', 'user.email=a@example.com', 'commit', '--quiet', '--message=From the remote')

    const repo = path.join(tmp, 'repo')
    const build = path.join(tmp, 'build')
    fs.mkdirSync(repo) // like an empty volume
    assert.deepEqual(initLayers(repo, build, remote).map(l => l.layer.id), ['test'])
    assert.ok(fs.existsSync(path.join(build, 'test.json')))
    assert.deepEqual(commits(repo), ['From the remote'])
    assert.equal(git(repo, 'remote', 'get-url', 'origin').trim(), remote)

    // A second start leaves the repo alone, even if the remote is gone.
    initLayers(repo, build, path.join(tmp, 'missing'))
    assert.deepEqual(commits(repo), ['From the remote'])

    assert.throws(() => initLayers(path.join(tmp, 'other'), build, path.join(tmp, 'missing')), /Command failed: git/)
})
