import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueEntry } from '../../../packages/hadley/addons/forms/screen.ts'
import { openSession } from '../../../packages/hadley/addons/forms/session.ts'
import { start, submission, submit, type Service } from './harness.ts'

// An owner's reply as `hadley comments` publishes it (packages/hadley/addons/forms/session.ts), and the service a
// visitor replies to it through: the reply's id must be one the service takes as a parent (CONTRACT.md C7).

let service: Service
let dir: string
before(async () => {
  service = await start()
  dir = mkdtempSync(join(tmpdir(), 'hadley-forms-owner-reply-'))
})
after(async () => {
  await service.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe("a visitor's reply to an owner's reply", () => {
  it('is accepted with 201', async () => {
    const work = join(dir, 'work')
    const archive = join(dir, 'archive')
    mkdirSync(work)
    mkdirSync(archive)
    const comment: QueueEntry = {
      id: '9c25c27e-14bd-4e93-81bd-33d751bc6017',
      article_id: 'first-light',
      language_version: 'en',
      parent_comment_id: null,
      name: 'Nora Example',
      email: '',
      submitted_at: '2026-10-23T12:00:00Z',
      text: 'Thank you for the clear explanation.',
      notify: false,
    }
    const opened = await openSession(work, archive, async () => ({ resumed: false, comments: [comment] }))
    assert.equal(opened.kind, 'downloaded')
    if (opened.kind !== 'downloaded') return
    await opened.session.draftReply(comment.id, 'Glad it helped.')
    const commentsPath = join(dir, 'comments.json')
    await opened.session.approve(comment, commentsPath, 'Ada')
    const tree = JSON.parse(readFileSync(commentsPath, 'utf8')) as { comments: { id: string }[] }[]
    const reply = tree[0]!.comments[0]!.id

    const response = await submit(service, await submission(service, { parent_comment_id: reply }))
    assert.equal(response.status, 201, await response.text())
  })
})
