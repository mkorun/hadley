import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { history, KEEP, pruned, seen, startHistory, steps, undone, without, type Version } from '../history.ts'
import { historyRoute } from '../history-routes.ts'
import { pageHeads } from '../plugin.ts'

let root: string
let page: string
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hadley-history-'))
  page = join(root, 'content', 'articles', '[a]', 'a.md')
  await mkdir(join(root, 'content', 'articles', '[a]'), { recursive: true })
})
afterEach(async () => {
  pageHeads.clear()
  await rm(root, { recursive: true, force: true })
})

describe('the versions of a page', () => {
  it('keeps each state once, newest first, and a text only by a hash of its log', async () => {
    const versions = history(root)
    assert.ok(await versions.record(page, 'one\n', 'outside'))
    assert.equal(await versions.record(page, 'one\n', 'outside'), undefined)
    await versions.record(page, 'two\n', 'editor', { what: 'edit' })
    const listed = await versions.list(page)
    assert.deepEqual(
      listed.map(({ hash: h, by, what }) => ({ h, by, what })),
      [
        { h: hash('two\n'), by: 'editor', what: 'edit' },
        { h: hash('one\n'), by: 'outside', what: undefined },
      ],
    )
    assert.equal(await versions.content(page, hash('one\n')), 'one\n')
    assert.equal(await versions.content(page, hash('never\n')), undefined)
    assert.equal(await versions.content(page, '../../config.lima'), undefined)
    // a second page with the same text shares its object
    const other = join(root, 'content', 'b.md')
    await versions.record(other, 'one\n', 'outside')
    assert.equal((await readdir(join(root, '.hadley', 'history', 'objects'))).length, 2)
    // a history of its own reads the logs as written
    assert.deepEqual(
      (await history(root).list(page)).map((v) => v.hash),
      listed.map((v) => v.hash),
    )
  })

  it('refuses a file outside the site', async () => {
    await assert.rejects(history(root).record(join(root, '..', 'x.md'), 'x', 'outside'), /outside the site/)
  })

  it('keeps the last 100 unnamed versions and every named one, and drops the objects no log names', async () => {
    const versions = history(root)
    await versions.record(page, 'v0\n', 'outside')
    assert.ok(await versions.name(page, hash('v0\n'), 'the first'))
    for (let i = 1; i <= KEEP + 5; i++) await versions.record(page, `v${i}\n`, 'editor', { what: 'edit' })
    const listed = await versions.list(page)
    assert.equal(listed.filter((v) => v.name === undefined).length, KEEP)
    assert.equal(listed.at(-1)?.name, 'the first')
    assert.equal(listed[0]?.hash, hash(`v${KEEP + 5}\n`))
    assert.equal(await versions.content(page, hash('v1\n')), undefined)
    const objects = await readdir(join(root, '.hadley', 'history', 'objects'))
    assert.equal(objects.length, KEEP + 1)
    assert.ok(!objects.includes(hash('v1\n')))
    // a name taken back: the version counts again, and the oldest unnamed goes
    assert.ok(await versions.name(page, hash('v0\n'), ''))
    assert.equal((await versions.list(page)).length, KEEP)
    assert.equal(await versions.name(page, hash('none\n'), 'x'), false)
  })

  it('names the version it is given by its time, where the same text came back later', async () => {
    const versions = history(root)
    const early = await versions.record(page, 'a\n', 'outside')
    await versions.record(page, 'b\n', 'editor', { what: 'edit' })
    await versions.record(page, 'a\n', 'restore')
    assert.ok(early)
    assert.ok(await versions.name(page, early.hash, 'the early one', early.at))
    assert.deepEqual(
      (await versions.list(page)).map((v) => v.name ?? ''),
      ['', '', 'the early one'],
    )
    assert.equal(await versions.name(page, early.hash, 'x', early.at + 1), false)
  })

  it('deletes one version or every unnamed one, never the newest, and the objects no log names', async () => {
    const versions = history(root)
    const first = await versions.record(page, 'a\n', 'outside')
    await versions.record(page, 'b\n', 'editor', { what: 'edit' })
    await versions.record(page, 'c\n', 'editor', { what: 'edit' })
    const newest = await versions.record(page, 'd\n', 'editor', { what: 'edit' })
    assert.ok(first && newest)
    assert.ok(await versions.name(page, hash('b\n'), 'kept'))
    // the newest is the page as it is: it never goes
    assert.equal(await versions.remove(page, newest.at, newest.hash), false)
    assert.equal(await versions.remove(page, first.at, hash('never\n')), false)
    assert.ok(await versions.remove(page, first.at, first.hash))
    assert.deepEqual(
      (await versions.list(page)).map((v) => v.hash),
      [hash('d\n'), hash('c\n'), hash('b\n')],
    )
    assert.equal(await versions.content(page, hash('a\n')), undefined)
    assert.ok(!(await readdir(join(root, '.hadley', 'history', 'objects'))).includes(hash('a\n')))
    // every unnamed one but the newest; the named stays
    assert.equal(await versions.removeUnnamed(page), 1)
    assert.deepEqual(
      (await versions.list(page)).map((v) => v.name ?? v.hash),
      [hash('d\n'), 'kept'],
    )
    assert.equal(await versions.removeUnnamed(page), 0)
    // a history of its own reads what was deleted
    assert.equal((await history(root).list(page)).length, 2)
  })

  it('never drops the newest, the page as it is', () => {
    const one = (i: number): Version => ({ at: i, hash: String(i).padStart(64, '0'), by: 'editor' })
    const versions = [...Array.from({ length: KEEP }, (_, i) => one(i)), { ...one(KEEP), name: 'n' }]
    const { kept, dropped } = pruned([...versions, { at: 999, hash: 'f'.repeat(64), by: 'editor' }])
    assert.equal(dropped.length, 1)
    assert.equal(kept.at(-1)?.hash, 'f'.repeat(64))
  })

  it('deletes the newest once undo took the page away from it, but never the version the page stands at', async () => {
    const versions = history(root)
    const first = await versions.record(page, 'a\n', 'outside')
    const newest = await versions.record(page, 'b\n', 'editor', { what: 'edit' })
    assert.ok(first && newest)
    assert.equal(await versions.remove(page, newest.at, newest.hash), false)
    await versions.stand(page, first.at)
    assert.equal(await versions.remove(page, first.at, first.hash), false)
    assert.ok(await versions.remove(page, newest.at, newest.hash))
    assert.deepEqual(
      (await versions.list(page)).map((x) => x.at),
      [first.at],
    )
  })

  it('says a page the build read is the agent’s while it works, else from outside', async () => {
    let agent: string | undefined = 'Claude Code'
    startHistory(root, () => agent)
    seen(page, 'by the agent\n')
    agent = undefined
    seen(page, 'by hand\n')
    // seen() does not wait; a list after it does
    const versions = history(root)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const listed = await versions.list(page)
    assert.deepEqual(
      listed.map(({ by, agent: name }) => ({ by, name })),
      [
        { by: 'outside', name: undefined },
        { by: 'agent', name: 'Claude Code' },
      ],
    )
  })
})

describe('the routes of the time machine', () => {
  let server: http.Server
  let origin: string
  beforeEach(async () => {
    startHistory(root)
    server = http.createServer((req, res) => {
      void historyRoute(req, res, 'en').then((answered) => {
        if (!answered) {
          res.statusCode = 404
          res.end()
        }
      })
    })
    server.listen(0, 'localhost')
    await once(server, 'listening')
    origin = `http://localhost:${(server.address() as AddressInfo).port}`
  })
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())))

  const post = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('lists, shows, names and restores the versions of a page the build knows, by its path only', async () => {
    await writeFile(page, 'first\n')
    seen(page, 'first\n')
    await writeFile(page, 'second\n')
    seen(page, 'second\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    // a page the build did not register has none, whatever the browser names
    assert.equal((await fetch(`${origin}/__hadley/history?path=/a/`)).status, 404)
    pageHeads.set('/a/', { filePath: page })

    const listed = (await (await fetch(`${origin}/__hadley/history?path=/a/`)).json()) as {
      current: string
      versions: Version[]
    }
    assert.equal(listed.current, hash('second\n'))
    assert.equal(listed.versions.length, 2)
    const old = await fetch(`${origin}/__hadley/history/version?path=/a/&hash=${hash('first\n')}`)
    assert.deepEqual(await old.json(), { text: 'first\n' })
    assert.equal((await fetch(`${origin}/__hadley/history/version?path=/a/&hash=${'0'.repeat(64)}`)).status, 404)

    assert.equal(
      (await post('/__hadley/history/name', { path: '/a/', hash: hash('first\n'), name: 'x'.repeat(81) })).status,
      400,
    )
    assert.equal(
      (await post('/__hadley/history/name', { path: '/a/', hash: hash('first\n'), name: 'start' })).status,
      200,
    )

    // going back only onto the page the panel showed
    const stale = await post('/__hadley/history/restore', {
      path: '/a/',
      hash: hash('first\n'),
      current: hash('other\n'),
    })
    assert.equal(stale.status, 409)
    const named = (await (await fetch(`${origin}/__hadley/history?path=/a/`)).json()) as { versions: Version[] }
    const source = named.versions.find((v) => v.hash === hash('first\n'))!
    const back = await post('/__hadley/history/restore', {
      path: '/a/',
      hash: hash('first\n'),
      at: source.at,
      current: hash('second\n'),
    })
    assert.equal(back.status, 200)
    assert.equal(await readFile(page, 'utf-8'), 'first\n')
    const after = (await (await fetch(`${origin}/__hadley/history?path=/a/`)).json()) as { versions: Version[] }
    // the restore names the version it brought back
    assert.equal(after.versions[0]?.from, source.at)
    // the page it left stays a version: forth again is as easy
    assert.deepEqual(
      after.versions.map((v) => [v.by, v.hash === hash('first\n') ? 'first' : 'second', v.name ?? '']),
      [
        ['restore', 'first', ''],
        ['outside', 'second', ''],
        ['outside', 'first', 'start'],
      ],
    )

    // deleting: one version by its time and hash, or every unnamed one; never the page as it is
    const [now, left] = after.versions
    assert.ok(now && left)
    assert.equal((await post('/__hadley/history/delete', { path: '/a/', hash: now.hash, at: now.at })).status, 404)
    assert.equal((await post('/__hadley/history/delete', { path: '/a/', hash: left.hash })).status, 400)
    assert.equal((await post('/__hadley/history/delete', { path: '/b/', unnamed: true })).status, 404)
    assert.equal((await post('/__hadley/history/delete', { path: '/a/', hash: left.hash, at: left.at })).status, 200)
    const all = await post('/__hadley/history/delete', { path: '/a/', unnamed: true })
    assert.deepEqual(await all.json(), { removed: 0 })
    const rest = (await (await fetch(`${origin}/__hadley/history?path=/a/`)).json()) as { versions: Version[] }
    assert.deepEqual(
      rest.versions.map((v) => [v.by, v.name ?? '']),
      [
        ['restore', ''],
        ['outside', 'start'],
      ],
    )
  })
  it('undoes and redoes the changes of a page, and only onto the page the button was shown for', async () => {
    await writeFile(page, 'one\n')
    seen(page, 'one\n')
    await writeFile(page, 'two\n')
    seen(page, 'two\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    pageHeads.set('/a/', { filePath: page })
    const ask = async () =>
      (await (await fetch(`${origin}/__hadley/history/steps?path=/a/`)).json()) as {
        current: string
        undo?: { by: string }
        redo?: { by: string }
      }
    const before = await ask()
    assert.equal(before.current, hash('two\n'))
    assert.equal(before.undo?.by, 'outside')
    assert.equal(before.redo, undefined)
    assert.equal((await post('/__hadley/history/step', { path: '/a/', way: 'undo', current: hash('x') })).status, 409)
    assert.equal(
      (await post('/__hadley/history/step', { path: '/a/', way: 'sideways', current: before.current })).status,
      400,
    )
    const list = async () =>
      (await (await fetch(`${origin}/__hadley/history?path=/a/`)).json()) as { at: number; versions: Version[] }
    const [second, first] = (await list()).versions
    assert.ok(first && second)
    const step = async (way: string, current: string) =>
      (await post('/__hadley/history/step', { path: '/a/', way, current })).status
    // back and forth, again and again: the page moves among the versions, and no version comes of it
    for (let i = 0; i < 3; i++) {
      assert.equal(await step('undo', (await ask()).current), 200)
      assert.equal(await readFile(page, 'utf-8'), 'one\n')
      seen(page, 'one\n')
      const undone = await ask()
      assert.equal(undone.undo, undefined)
      assert.equal(undone.redo?.by, 'outside')
      assert.equal((await list()).at, first.at)
      assert.equal(await step('redo', undone.current), 200)
      assert.equal(await readFile(page, 'utf-8'), 'two\n')
      seen(page, 'two\n')
      assert.equal((await ask()).redo, undefined)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal((await list()).versions.length, 2)
    assert.equal((await list()).at, second.at)
  })
})

describe('undo and redo', () => {
  const v = (at: number, by: Version['by'], after?: number): Version => ({
    at,
    hash: String(at).padStart(64, '0'),
    by,
    ...(after === undefined ? {} : { after }),
  })
  const of = (result: ReturnType<typeof steps>) => ({
    undo: result.undo && [result.undo.change.at, result.undo.target.at],
    redo: result.redo && [result.redo.change.at, result.redo.target.at],
  })

  it('goes back along the versions each change was made on, the agent’s and those from outside too, and forth', () => {
    const log = [v(1, 'outside'), v(2, 'editor', 1), v(3, 'agent', 2)]
    assert.deepEqual(of(steps(log, 3)), { undo: [3, 2], redo: undefined })
    assert.deepEqual(of(steps(log, 2)), { undo: [2, 1], redo: [3, 3] })
    assert.deepEqual(of(steps(log, 1)), { undo: undefined, redo: [2, 2] })
  })

  it('a change after an undo is made on the version undo went to: undo goes back there', () => {
    const log = [v(1, 'outside'), v(2, 'editor', 1), v(3, 'editor', 2), v(4, 'editor', 1)]
    assert.deepEqual(of(steps(log, 4)), { undo: [4, 1], redo: undefined })
    // from 1, redo brings back the newest made on it
    assert.deepEqual(of(steps(log, 1)), { undo: undefined, redo: [4, 4] })
    // an older log, without `after`: each version made on the one before it
    const older = [v(1, 'outside'), v(2, 'editor'), v(3, 'editor')]
    assert.deepEqual(of(steps(older, 3)), { undo: [3, 2], redo: undefined })
    assert.deepEqual(of(steps([], 1)), { undo: undefined, redo: undefined })
  })

  it('keeps the chain whole when versions go: what was made on one gone is made on the one below it', () => {
    const log = [v(1, 'outside'), v(2, 'editor', 1), v(3, 'editor', 2), v(4, 'editor', 3)]
    const kept = without(log, new Set([log[1]!, log[2]!]))
    assert.deepEqual(
      kept.map((x) => [x.at, x.after]),
      [
        [1, undefined],
        [4, 1],
      ],
    )
    assert.deepEqual([...undone(kept, 4)], [])
    // a log from before: a version naming one that is gone falls back to the one before it (Michael, 2026-11-09)
    const torn = [v(1, 'outside'), v(5, 'restore', 3)]
    assert.deepEqual([...undone(torn, 5)], [])
    assert.deepEqual(of(steps(torn, 5)), { undo: [5, 1], redo: undefined })
  })

  it('names the versions undo took the page away from: all but its own and those it was made on', () => {
    const log = [v(1, 'outside'), v(2, 'editor', 1), v(3, 'editor', 2), v(4, 'editor', 1)]
    assert.deepEqual([...undone(log, 2)].sort(), [3, 4])
    // a change after an undo: what undo took away stays undone
    assert.deepEqual([...undone(log, 4)].sort(), [2, 3])
    assert.deepEqual([...undone(log, 3)].sort(), [4])
  })
})
