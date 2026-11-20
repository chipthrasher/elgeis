import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { LayersRepo } from './layers.ts'
import { git, NATION, testRepo } from './test-layers.ts'

const subjects = (repo: string) => git(repo, 'log', '--format=%s').trim().split('\n')

test('the repo is cloned from the remote into an empty folder once, then built', () => {
    const { tmp, dir, build, remote, repo } = testRepo()
    assert.deepEqual(repo.data.map(l => l.layer.id), ['political'])
    assert.ok(fs.existsSync(path.join(build, 'political.json')))
    assert.deepEqual(subjects(dir), ['From the remote'])
    assert.equal(git(dir, 'remote', 'get-url', 'origin').trim(), remote)

    // A second start leaves the repo alone, even if the remote is gone.
    new LayersRepo(dir, build, path.join(tmp, 'missing'))
    assert.deepEqual(subjects(dir), ['From the remote'])

    assert.throws(() => new LayersRepo(path.join(tmp, 'other'), build, path.join(tmp, 'missing')), /Command failed: git/)
})

test('commits write, delete, rebuild, and push', () => {
    const { dir, build, remote, repo } = testRepo()
    const renamed = { ...NATION, properties: { ...NATION.properties, name: 'Emeraldia' } }
    const layers = [{ layer: repo.data[0].layer, objects: [renamed as never] }]
    const hash = repo.commit({
        layers,
        changed: new Map([['political', ['ent_a', 'pol_a']]]),
        author: { name: 'Steve', email: 'steve@users.noreply.map.test' },
        message: 'Rename Adfelis\n\nChange-Request: 7\n',
    })
    assert.match(hash, /^[0-9a-f]{40}$/)
    assert.equal(git(dir, 'log', '-1', '--format=%an <%ae>').trim(), 'Steve <steve@users.noreply.map.test>')
    assert.deepEqual(fs.readdirSync(path.join(dir, 'political')).sort(), ['ent_a.json', 'layer.json'])
    assert.match(fs.readFileSync(path.join(build, 'political.json'), 'utf8'), /Emeraldia/)
    assert.deepEqual(repo.recentCommits(5).map(c => c.message.split('\n')[0]), ['Rename Adfelis', 'From the remote'])
    assert.equal(repo.recentCommits(1)[0].hash, hash)

    repo.push()
    assert.equal(git(remote, 'rev-parse', 'HEAD').trim(), hash)
})

test("a commit that doesn't build is undone", () => {
    const { dir, repo } = testRepo()
    const before = git(dir, 'rev-parse', 'HEAD')
    // Deleting the nation leaves its polygon listing a missing entity.
    assert.throws(() => repo.commit({
        layers: [{ layer: repo.data[0].layer, objects: repo.data[0].objects.filter(o => o.id !== 'ent_a') }],
        changed: new Map([['political', ['ent_a']]]),
        author: { name: 'Steve', email: 's@example.com' },
        message: 'Oops',
    }), /Lists missing entity "Adfelis"/)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), before)
    assert.equal(git(dir, 'status', '--porcelain'), '')
    assert.equal(repo.data[0].objects.length, 2)
})
