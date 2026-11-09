/**
 * A page's Markdown file as the editor reads and writes it: in LF, with the hash of what was read, written back with
 * the line ends it had; and the page before and after a change kept as versions (history.ts).
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { lf } from '../../lib/platform.ts'
import { siteHistory, type What } from './history.ts'

export function fileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A file as the editor edits it: its text with LF line ends, and the hash of what was read. */
export interface Source {
  content: string
  hash: string
  crlf: boolean // the file has CRLF throughout, and gets it back on writing
}

/**
 * The block offsets count one character for a line end (renderer.ts), so the editor edits a file with CRLF line ends
 * in LF and writes it back with CRLF. A file that mixes line ends could not be written back as it was: it is refused.
 */
export async function readSource(filePath: string): Promise<Source | 'unreadable' | 'mixed'> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    return 'unreadable'
  }
  const content = lf(raw)
  const crlfs = raw.length - content.length
  const lineFeeds = content.split('\n').length - 1
  if (content.includes('\r') || (crlfs > 0 && crlfs !== lineFeeds)) return 'mixed'
  return { content, hash: fileHash(raw), crlf: crlfs > 0 }
}

/** `text`, edited in LF, with the line ends of the file it came from. */
export const written = (source: Source, text: string): string => (source.crlf ? text.replace(/\n/g, '\r\n') : text)

/** The page before and after a change of the editor, as versions (history.ts); before only if it was not kept yet. */
export async function keepVersions(file: string, source: Source, after: string, what: What): Promise<void> {
  const versions = siteHistory()
  if (!versions) return
  await versions.record(file, written(source, source.content), 'outside').catch(() => undefined)
  await versions.record(file, after, 'editor', { what }).catch(() => undefined)
}
