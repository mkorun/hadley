import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startHistory } from '../history.ts'
import { blockIdMap } from '../blocks.ts'
import { wroteItself } from '../upload.ts'
import { handleTrash } from '../trash.ts'

let root: string
let bundle: string
let server: http.Server
let origin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hadley-trash-'))
  bundle = join(root, 'content', 'articles', '[a]')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'a.md'), 'A page with ![](kept.png).\n')
  await writeFile(join(bundle, 'gone.png'), 'gone')
  await writeFile(join(bundle, 'kept.png'), 'kept')
  await writeFile(join(root, 'outside.png'), 'outside')
  blockIdMap.set('b1', { filePath: join(bundle, 'a.md'), start: 0, end: 10, fileHashAtRender: '' })
  startHistory(root)
  server = http.createServer((req, res) => void handleTrash(req, res, 'en'))
  server.listen(0, 'localhost')
  await once(server, 'listening')
  origin = `http://localhost:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  blockIdMap.clear()
  await rm(root, { recursive: true, force: true })
})

const trash = (body: unknown) =>
  fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('a file of the bundle taken away', () => {
  it('moves it into the site’s .hadley/trash/, under its path, and its going rebuilds nothing', async () => {
    const res = await trash({ block: 'b1', name: 'gone.png' })
    assert.equal(res.status, 200)
    const { trash: where } = (await res.json()) as { trash: string }
    assert.match(where, /^\.hadley\/trash\/\d{4}-\d\d-\d\d-\d{6}\/content\/articles\/\[a\]\/gone\.png$/)
    assert.equal(await readFile(join(root, where), 'utf-8'), 'gone')
    assert.deepEqual((await readdir(bundle)).sort(), ['a.md', 'kept.png'])
    assert.equal(wroteItself(join(bundle, 'gone.png')), true)
  })

  it('overwrites nothing in the trash: the same file taken away twice keeps both', async () => {
    // review 2026-11-09: within a second the second went to the first one's place
    const first = (await (await trash({ block: 'b1', name: 'gone.png' })).json()) as { trash: string }
    await writeFile(join(bundle, 'gone.png'), 'gone again')
    const second = (await (await trash({ block: 'b1', name: 'gone.png' })).json()) as { trash: string }
    assert.notEqual(second.trash, first.trash)
    assert.equal(await readFile(join(root, first.trash), 'utf-8'), 'gone')
    assert.equal(await readFile(join(root, second.trash), 'utf-8'), 'gone again')
  })

  it('takes only a file the bundle’s list names: no other name, no page, nothing outside', async () => {
    assert.equal((await trash({ block: 'b1', name: '../../../outside.png' })).status, 404)
    assert.equal((await trash({ block: 'b1', name: 'a.md' })).status, 404)
    assert.equal((await trash({ block: 'nope', name: 'gone.png' })).status, 404)
    assert.equal((await trash({ block: 'b1' })).status, 404)
    assert.equal((await fetch(origin, { method: 'POST', body: '[' })).status, 400)
    // a link the list leaves out
    await symlink(join(root, 'outside.png'), join(bundle, 'linked.png'))
    assert.equal((await trash({ block: 'b1', name: 'linked.png' })).status, 404)
    assert.equal(await readFile(join(root, 'outside.png'), 'utf-8'), 'outside')
  })
})
