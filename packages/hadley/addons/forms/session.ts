// A moderation session of `hadley comments` (docs/comments.md), without its screen: the downloaded comments in a work
// file (`<workDir>/comments-<timestamp>.json`, those not yet decided) and in the archive (`<archiveDir>/` under the
// same name, every one with its decision), as services/forms/CONTRACT.md C10 describes them.

import { existsSync } from 'node:fs'
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mergeComment } from './merge.ts'
import type { QueueEntry } from './screen.ts'

export interface ArchiveEntry extends QueueEntry {
  decision: 'approved' | 'rejected' | null
  moderator_remark: string | null
  author_reply_draft: string | null
  decided_at: string | null
  mail_sent: boolean
}

/** What opening a session found: an interrupted one, a new download, or nothing to moderate. */
export type Opened =
  | { kind: 'resumed'; session: Session; file: string }
  | { kind: 'downloaded'; session: Session; serverResumed: boolean }
  | { kind: 'nothing'; serverResumed: boolean }

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n')

/**
 * Continues the newest work file in `workDir` that still holds comments, else downloads (`download`) and starts a
 * new one; an empty work file left behind is deleted.
 */
export async function openSession(
  workDir: string,
  archiveDir: string,
  download: () => Promise<{ resumed: boolean; comments: QueueEntry[] }>,
): Promise<Opened> {
  const files = (await readdir(workDir)).filter((f) => f.startsWith('comments-') && f.endsWith('.json')).sort()
  const newest = files.at(-1)
  if (newest) {
    const workPath = join(workDir, newest)
    const left: QueueEntry[] = JSON.parse(await readFile(workPath, 'utf-8'))
    if (left.length > 0) {
      const archivePath = join(archiveDir, newest)
      return {
        kind: 'resumed',
        file: newest,
        session: new Session(workPath, existsSync(archivePath) ? archivePath : null, left.length),
      }
    }
    await unlink(workPath)
  }
  const { resumed, comments } = await download()
  if (comments.length === 0) return { kind: 'nothing', serverResumed: resumed }
  const name = `comments-${timestamp()}.json`
  const workPath = join(workDir, name)
  const archivePath = join(archiveDir, name)
  await writeJson(workPath, comments)
  await writeJson(
    archivePath,
    comments.map((c) => ({
      ...c,
      decision: null,
      moderator_remark: null,
      author_reply_draft: null,
      decided_at: null,
      mail_sent: false,
    })),
  )
  return { kind: 'downloaded', serverResumed: resumed, session: new Session(workPath, archivePath, comments.length) }
}

export class Session {
  readonly workPath: string
  readonly archivePath: string | null // missing when an interrupted session's archive is gone
  readonly total: number

  constructor(workPath: string, archivePath: string | null, total: number) {
    this.workPath = workPath
    this.archivePath = archivePath
    this.total = total
  }

  /** The comments not yet decided, in their order. */
  async pending(): Promise<QueueEntry[]> {
    return JSON.parse(await readFile(this.workPath, 'utf-8'))
  }

  /** What the archive holds of comment `id`. */
  async archived(id: string): Promise<ArchiveEntry | undefined> {
    if (!this.archivePath) return undefined
    const entries: ArchiveEntry[] = JSON.parse(await readFile(this.archivePath, 'utf-8'))
    return entries.find((e) => e.id === id)
  }

  /**
   * Publishes `entry` into `commentsPath` (the article's comments.json), with the reply drafted for it under
   * `authorName`, and takes it off the work file.
   */
  async approve(entry: QueueEntry, commentsPath: string, authorName: string): Promise<void> {
    await mergeComment(commentsPath, entry)
    const reply = (await this.archived(entry.id))?.author_reply_draft
    if (reply)
      await mergeComment(commentsPath, {
        id: crypto.randomUUID(),
        parent_comment_id: entry.id,
        name: authorName,
        submitted_at: nowIso(),
        text: reply,
        author_reply: true,
      })
    await this.record(entry.id, { decision: 'approved', decided_at: nowIso() })
    await this.drop(entry.id)
  }

  async reject(id: string): Promise<void> {
    await this.record(id, { decision: 'rejected', decided_at: nowIso() })
    await this.drop(id)
  }

  /** Replaces the text of comment `id` before it is decided. */
  async edit(id: string, text: string): Promise<void> {
    const work = await this.pending()
    for (const entry of work) if (entry.id === id) entry.text = text
    await writeJson(this.workPath, work)
  }

  note = (id: string, note: string) => this.record(id, { moderator_remark: note })
  draftReply = (id: string, reply: string) => this.record(id, { author_reply_draft: reply })
  mailWritten = (id: string) => this.record(id, { mail_sent: true })

  /** Deletes the work file once nothing is left in it; reports whether it did. */
  async finish(): Promise<boolean> {
    if ((await this.pending()).length > 0) return false
    await unlink(this.workPath)
    return true
  }

  private async record(id: string, patch: Partial<ArchiveEntry>): Promise<void> {
    if (!this.archivePath) return
    const entries: ArchiveEntry[] = JSON.parse(await readFile(this.archivePath, 'utf-8'))
    await writeJson(
      this.archivePath,
      entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )
  }

  private async drop(id: string): Promise<void> {
    await writeJson(
      this.workPath,
      (await this.pending()).filter((e) => e.id !== id),
    )
  }
}
