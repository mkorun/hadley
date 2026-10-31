import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueEntry } from '../screen.ts'
import { openSession } from '../session.ts'

// A moderation session (session.ts): the work file, the archive, the decisions (services/forms/CONTRACT.md C10).

let dir: string
let work: string
let archive: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-comments-session-test-'))
  work = join(dir, 'work')
  archive = join(dir, 'archive')
  mkdirSync(work)
  mkdirSync(archive)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const comment = (id: string, text = 'Text'): QueueEntry => ({
  id,
  article_id: 'a',
  language_version: 'de',
  parent_comment_id: null,
  name: `Name ${id}`,
  email: `${id}@example.org`,
  submitted_at: '2026-10-27T10:00:00Z',
  text,
  notify: false,
})
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const download =
  (comments: QueueEntry[], resumed = false) =>
  async () => ({ resumed, comments })

describe('a moderation session', () => {
  it('downloads into a work file and an archive of the same name, and decides each comment', async () => {
    const opened = await openSession(work, archive, download([comment('1'), comment('2'), comment('3')]))
    assert.equal(opened.kind, 'downloaded')
    if (opened.kind !== 'downloaded') return
    const { session } = opened
    assert.equal(session.total, 3)
    const commentsPath = join(dir, 'bundle', 'comments.json')

    await session.draftReply('1', 'Danke!')
    await session.note('1', 'nett')
    await session.approve(comment('1'), commentsPath, 'Ada')
    await session.edit('2', 'Neu')
    assert.equal((await session.pending())[0]!.text, 'Neu')
    await session.reject('2')
    await session.mailWritten('3')

    const published = json(commentsPath)
    assert.deepEqual(
      published.map((c: { name: string; comments: { name: string; author_reply: boolean }[] }) => [
        c.name,
        c.comments.map((r) => [r.name, r.author_reply]),
      ]),
      [['Name 1', [['Ada', true]]]],
    )
    const decided = json(session.archivePath!)
    assert.deepEqual(
      decided.map((e: { id: string; decision: string | null; moderator_remark: string | null; mail_sent: boolean }) => [
        e.id,
        e.decision,
        e.moderator_remark,
        e.mail_sent,
      ]),
      [
        ['1', 'approved', 'nett', false],
        ['2', 'rejected', null, false],
        ['3', null, null, true],
      ],
    )
    assert.deepEqual(
      (await session.pending()).map((e) => e.id),
      ['3'],
    )
    assert.equal(await session.finish(), false, 'one left')
    await session.reject('3')
    assert.equal(await session.finish(), true)
    assert.deepEqual(readdirSync(work), [])
  })

  it('continues an interrupted session before it downloads anything, and drops an empty work file', async () => {
    writeFileSync(join(work, 'comments-2026-10-01_10-00-00.json'), '[]\n')
    writeFileSync(join(work, 'comments-2026-10-02_10-00-00.json'), JSON.stringify([comment('9')]))
    writeFileSync(
      join(archive, 'comments-2026-10-02_10-00-00.json'),
      JSON.stringify([{ ...comment('9'), decision: null }]),
    )
    let downloaded = false
    const opened = await openSession(work, archive, async () => {
      downloaded = true
      return { resumed: false, comments: [] }
    })
    assert.equal(opened.kind, 'resumed')
    assert.equal(downloaded, false)
    if (opened.kind === 'resumed') assert.equal(opened.file, 'comments-2026-10-02_10-00-00.json')

    rmSync(join(work, 'comments-2026-10-02_10-00-00.json'))
    const next = await openSession(work, archive, download([], true))
    assert.deepEqual(next, { kind: 'nothing', serverResumed: true })
    assert.equal(existsSync(join(work, 'comments-2026-10-01_10-00-00.json')), false, 'the empty work file is gone')
  })
})
