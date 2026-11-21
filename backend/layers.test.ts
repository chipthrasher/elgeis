import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { formatJson } from '../shared/format.ts'
import { LayersRepo } from './layers.ts'
import { git, NATION, POLYGON, testRepo } from './test-layers.ts'

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
    }), /Lists missing entity "ent_a"/)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), before)
    assert.equal(git(dir, 'status', '--porcelain'), '')
    assert.equal(repo.data[0].objects.length, 2)
})

// A commit made straight to the remote, as if by hand.
function commitToRemote(remote: string, file: string, object: object) {
    fs.writeFileSync(path.join(remote, 'political', file), formatJson(object))
    git(remote, 'add', '--all')
    git(remote, '-c', 'user.name=B', '-c', 'user.email=b@example.com', 'commit', '--quiet', '--message=By hand')
}
const named = (name: string) => ({ ...NATION, properties: { ...NATION.properties, name } })
const rename = (repo: LayersRepo, name: string) => repo.commit({
    layers: [{ layer: repo.data[0].layer, objects: [named(name) as never, POLYGON] }],
    changed: new Map([['political', ['ent_a']]]),
    author: { name: 'Steve', email: 's@example.com' },
    message: `Rename to ${name}`,
})

test("sync pulls in the remote's commits and rebuilds", () => {
    const { remote, build, repo } = testRepo()
    assert.equal(repo.sync(), false)
    commitToRemote(remote, 'ent_a.json', named('Emeraldia'))
    assert.equal(repo.sync(), true)
    assert.equal(repo.data[0].objects.find(o => o.id === 'ent_a')!.properties.name, 'Emeraldia')
    assert.match(fs.readFileSync(path.join(build, 'political.json'), 'utf8'), /Emeraldia/)
    assert.equal(repo.sync(), false)
})

test('sync puts unpushed commits on top of the remote, so they push', () => {
    const { dir, remote, repo } = testRepo()
    commitToRemote(remote, 'ent_b.json', { ...NATION, id: 'ent_b', properties: { name: 'Goomlandia' } })
    rename(repo, 'Emeraldia')
    repo.push() // refused: the remote has a commit we don't
    assert.deepEqual(subjects(remote), ['By hand', 'From the remote'])

    assert.equal(repo.sync(), true)
    assert.deepEqual(subjects(dir), ['Rename to Emeraldia', 'By hand', 'From the remote'])
    assert.deepEqual(repo.data[0].objects.map(o => o.id).sort(), ['ent_a', 'ent_b', 'pol_a'])
    repo.push()
    assert.equal(git(remote, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', 'HEAD'))
})

test("sync changes nothing if the remote's commits conflict with ours", () => {
    const { dir, remote, repo } = testRepo()
    commitToRemote(remote, 'ent_a.json', named('Goomlandia'))
    rename(repo, 'Emeraldia')
    const head = git(dir, 'rev-parse', 'HEAD')
    assert.throws(() => repo.sync(), /conflict with this site's unpushed changes/)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head)
    assert.equal(git(dir, 'status', '--porcelain'), '')
    assert.equal(repo.data[0].objects.find(o => o.id === 'ent_a')!.properties.name, 'Emeraldia')
})

test("sync changes nothing if the remote's commits don't build", () => {
    const { dir, remote, repo } = testRepo()
    const head = git(dir, 'rev-parse', 'HEAD')
    // A polygon listing a nation that doesn't exist.
    commitToRemote(remote, 'pol_b.json', { ...POLYGON, id: 'pol_b', properties: { entities: ['ent_zzz'] } })
    assert.throws(() => repo.sync(), /don't build/)
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head)
    assert.equal(repo.data[0].objects.length, 2)
})

test("sync carries on if the remote can't be reached", () => {
    const { dir, tmp, repo } = testRepo()
    git(dir, 'remote', 'set-url', 'origin', path.join(tmp, 'missing'))
    assert.equal(repo.sync(), false)
})
