import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initLayers } from './layers.ts'

test('initLayers starts a repo from the bundled layers once, then builds it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
    const repo = path.join(tmp, 'repo')
    const build = path.join(tmp, 'build')

    const layers = initLayers(repo, 'layers', build)
    assert.ok(layers.length > 0)
    assert.ok(fs.existsSync(path.join(build, 'index.json')))
    const log = () => execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf8' })
    assert.equal(log().trim().split('\n').length, 1)

    // A second start leaves the repo alone.
    initLayers(repo, 'layers', build)
    assert.equal(log().trim().split('\n').length, 1)
    fs.rmSync(tmp, { recursive: true })
})
