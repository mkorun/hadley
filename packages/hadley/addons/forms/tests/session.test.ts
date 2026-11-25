import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueEntry } from '../screen.ts'
import { mergeComment } from '../merge.ts'
import { nameBasedUuid, openSession, replyId } from '../session.ts'

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

  it('leaves a comment as it was published when the service gives it a second time, with no second reply', async () => {
    const commentsPath = join(dir, 'bundle', 'comments.json')
    for (const reply of ['Danke!', 'Nochmals danke!']) {
      const opened = await openSession(work, archive, download([comment('1')]))
      assert.equal(opened.kind, 'downloaded')
      if (opened.kind !== 'downloaded') return
      await opened.session.draftReply('1', reply)
      await opened.session.approve(comment('1'), commentsPath, 'Ada')
      assert.equal(await opened.session.finish(), true)
    }
    assert.deepEqual(
      json(commentsPath).map((c: { id: string; comments: { text: string }[] }) => [
        c.id,
        c.comments.map((r) => r.text),
      ]),
      [['1', ['Danke!']]],
    )
  })

  it('publishes the drafted reply once after a run that stopped between the comment and its reply', async () => {
    const commentsPath = join(dir, 'bundle', 'comments.json')
    const opened = await openSession(work, archive, download([comment('1')]))
    assert.equal(opened.kind, 'downloaded')
    if (opened.kind !== 'downloaded') return
    await opened.session.draftReply('1', 'Danke!')
    // the run stops here: the comment is in comments.json, the work file and the archive are as they were
    await mergeComment(commentsPath, comment('1'))

    const resumed = await openSession(work, archive, download([]))
    assert.equal(resumed.kind, 'resumed')
    if (resumed.kind !== 'resumed') return
    await resumed.session.approve(comment('1'), commentsPath, 'Ada')
    // and once more, as after a run that stopped before it took the comment off the work file
    await resumed.session.approve(comment('1'), commentsPath, 'Ada')
    assert.deepEqual(
      json(commentsPath).map((c: { id: string; comments: { id: string; text: string }[] }) => [
        c.id,
        c.comments.map((r) => [r.id, r.text]),
      ]),
      [['1', [[replyId('1'), 'Danke!']]]],
    )
  })

  it('publishes a reply once after a run of an older hadley, which gave it a random id, stopped', async () => {
    const commentsPath = join(dir, 'bundle', 'comments.json')
    const opened = await openSession(work, archive, download([comment('1')]))
    assert.equal(opened.kind, 'downloaded')
    if (opened.kind !== 'downloaded') return
    await opened.session.draftReply('1', 'Danke!')
    // the older run published the comment and its reply, and stopped before it took the comment off the work file
    await mergeComment(commentsPath, comment('1'))
    await mergeComment(commentsPath, {
      id: crypto.randomUUID(),
      parent_comment_id: '1',
      name: 'Ada',
      submitted_at: '2026-10-27T11:00:00Z',
      text: 'Danke!',
      author_reply: true,
    })

    const resumed = await openSession(work, archive, download([]))
    assert.equal(resumed.kind, 'resumed')
    if (resumed.kind !== 'resumed') return
    await resumed.session.approve(comment('1'), commentsPath, 'Ada')
    assert.deepEqual(
      json(commentsPath).map((c: { id: string; comments: { text: string }[] }) => [
        c.id,
        c.comments.map((r) => r.text),
      ]),
      [['1', ['Danke!']]],
    )
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

describe("the id of an owner's reply", () => {
  it('is a name-based UUID, version 5, as RFC 9562 makes one', () => {
    // RFC 9562, Appendix A.4: www.example.com in the DNS namespace
    assert.equal(
      nameBasedUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'),
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    )
  })

  it('is the same UUID for a comment in every run, and another for another comment', () => {
    const id = replyId('9c25c27e-14bd-4e93-81bd-33d751bc6017')
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(replyId('9c25c27e-14bd-4e93-81bd-33d751bc6017'), id)
    assert.notEqual(replyId('0b8f3d4e-0000-4000-8000-000000000000'), id)
  })
})
