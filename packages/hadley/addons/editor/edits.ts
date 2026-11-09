/**
 * What the editor changes in a page's Markdown: a block read, saved (a new one below it too), deleted, moved and
 * merged, each checked against the file as the page was rendered, and refused where Markanto would read the page
 * otherwise than the change meant.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { parseDocument, checkOnlyEditedBlockChanged } from '../../case/index.ts'
import { blockIdMap, headLine, headText } from './blocks.ts'
import { getLang, readBody, send } from './http.ts'
import { t } from './i18n.ts'
import { lf } from '../../lib/platform.ts'
import { fileHash, keepVersions, readSource, written } from './source.ts'

export async function handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  const blockId = (req.url ?? '').slice('/__hadley/block/'.length).split('?')[0]
  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  // the offsets are those of the file as it was rendered: one that changed since is reloaded first (spec 5.4 took the
  // new hash as the baseline and kept the old offsets, so a save wrote over the wrong text; review 2026-10-29)
  if (source.hash !== entry.fileHashAtRender) return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })

  const text = content.slice(entry.start, entry.end - 1)
  send(res, 200, { text: entry.head ? headText(entry.head, text) : text })
}

/**
 * A block's text with one blank line between its parts, as Markanto writes them, and none at its start or its end:
 * Enter pressed to make room for a paragraph left two blank lines in the file (2026-11-05). Inside a code fence every
 * line stays as it is.
 */
export function blankLinesOnce(text: string): string {
  const lines: string[] = []
  let fence: { mark: string; length: number } | undefined
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (marker && marker[0] === fence.mark && marker.length >= fence.length && line.trim() === marker)
        fence = undefined
    } else {
      if (line.trim() === '' && (lines.length === 0 || lines.at(-1)!.trim() === '')) continue
      if (marker) fence = { mark: marker[0]!, length: marker.length }
    }
    lines.push(line)
  }
  while (!fence && lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
  return lines.join('\n')
}

export async function handlePatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  // Check the Content-Type (spec 5.5)
  const ct = req.headers['content-type'] ?? ''
  if (ct.split(';')[0]!.trim().toLowerCase() !== 'application/json')
    return send(res, 415, { error: t(lang, 'contentTypeMustBeJson') })

  let parsed: unknown
  try {
    const body = await readBody(req, lang)
    parsed = JSON.parse(body)
  } catch {
    return send(res, 400, { error: t(lang, 'invalidJson') })
  }

  if (!parsed || typeof parsed !== 'object') return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  const { blockId, newText, below } = parsed as Record<string, unknown>

  // Check the required fields before reading the map (spec 5.5)
  if (typeof blockId !== 'string') return send(res, 400, { error: t(lang, 'blockIdMissing') })
  if (typeof newText !== 'string') return send(res, 400, { error: t(lang, 'newTextMissing') })

  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  // a new block below one is written after it: the block's own text stays as it is, byte for byte (review 2026-11-05)
  if (below !== undefined && below !== true) return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  if (below && entry.fixed) return send(res, 400, { error: t(lang, 'blockFixed') })
  if (below && !newText.trim()) return send(res, 400, { error: t(lang, 'newTextMissing') })

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  // Hash check: no blind overwrite after a concurrent edit (spec 5.5, ADR-7)
  if (source.hash !== entry.fileHashAtRender) {
    return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  }

  // Normalise the trailing \n: a textarea value can end with \n, which would make \n\n. A lone \r is no line end the
  // file could get back: before a \n it would be one, \r\r\n in a file with CRLF. A title or subtitle comes as its
  // text and goes back into its line.
  const line = entry.head ? headLine(entry.head, lf(newText)) : undefined
  if (entry.head && line === undefined) return send(res, 422, { error: t(lang, 'headEmpty') })
  const text = line ?? lf(newText)
  if (text.includes('\r')) return send(res, 422, { error: t(lang, 'loneCarriageReturn') })
  // the front matter is Lima, whose block scalars keep every blank line they hold (review 2026-11-05): only its end
  // is trimmed; Markdown gets one blank line between its parts
  const normalizedText = below
    ? `${content.slice(entry.start, entry.end).replace(/\n+$/, '')}\n\n${blankLinesOnce(text)}`
    : entry.fixed && !entry.head
      ? text.replace(/\n+$/, '')
      : blankLinesOnce(text)
  const patched = content.slice(0, entry.start) + normalizedText + '\n' + content.slice(entry.end)

  // Parse validation: the whole patched document is checked, not the block alone (spec 5.5, ADR-4). parseDocument()
  // never throws (errorRecovery: true); errors show in result.parseErrors instead (status 'invalid' in the parser). The
  // edit is refused only when an error overlaps the block being edited (`local`, file-absolute in the NEW document:
  // [entry.start, entry.start + normalizedText.length + 1)); an unrelated error elsewhere that was there before does
  // NOT refuse it (it used to be a gate for the whole document, see the documentation audit 2026-09; the integrity
  // check below is what makes that safe). A diagnostic without `start`/`end` (rare, for example a resource budget) is
  // taken as `local`. The messages come from the Markanto parser itself and stay untranslated.
  const patchResult = parseDocument(patched, {})
  if (patchResult.parseErrors?.length) {
    const newBlockEnd = entry.start + normalizedText.length + 1
    const errors = patchResult.parseErrors.map((e) => ({
      message: e.message,
      ...(e.start !== undefined ? { start: e.start } : {}),
      ...(e.end !== undefined ? { end: e.end } : {}),
      local: e.start === undefined || e.end === undefined || (e.start < newBlockEnd && e.end > entry.start),
    }))
    if (errors.some((e) => e.local)) {
      const message = errors.map((e) => e.message).join('; ')
      return send(res, 422, { error: `${t(lang, 'parseError')}: ${message}`, errors })
    }
    // Only errors that were there before and are unrelated are left: on to the integrity check.
  }

  // A safeguard beyond "the edited block has no errors": a diagnostic does not see a construct that silently changes
  // the meaning of NEIGHBOURING content (for example a fence opened by mistake that swallows the next block); the block
  // would be "free of errors locally" although it destroyed its neighbours. So every block outside the edited one must
  // still mean what it meant before (even when the document as a whole stays invalid through an older error elsewhere;
  // checkOnlyEditedBlockChanged then compares through RecoveryDocument/ErrorBlock). ONLY this check makes it safe to
  // leave out the gate for the whole document above.
  const integrity = checkOnlyEditedBlockChanged(content, patched, { start: entry.start, end: entry.end })
  if (!integrity.ok) {
    return send(res, 422, { error: t(lang, 'editChangedOtherContent') })
  }

  // A title or subtitle the text gives stays one: neither its own edit (`one__ two __three` would close `__` early)
  // nor a front matter that gives one may turn its line into a paragraph, which could then be deleted (review
  // 2026-11-05). The integrity check above compares Markanto's blocks before the title is taken: it cannot see this.
  const before = parseDocument(content, {}).heads
  for (const kind of ['title', 'subtitle'] as const)
    if (before[kind] && !patchResult.heads[kind]) return send(res, 422, { error: t(lang, 'headLost') })

  try {
    const text = written(source, patched)
    await writeFile(entry.filePath, text, 'utf-8')
    await keepVersions(entry.filePath, source, text, below ? 'new' : 'edit')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }

  // No reload of our own: Vite's watcher does it (ADR-3)
  send(res, 200, { ok: true })
}

export async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  const ct = req.headers['content-type'] ?? ''
  if (ct.split(';')[0]!.trim().toLowerCase() !== 'application/json')
    return send(res, 415, { error: t(lang, 'contentTypeMustBeJson') })

  let parsed: unknown
  try {
    const body = await readBody(req, lang)
    parsed = JSON.parse(body)
  } catch {
    return send(res, 400, { error: t(lang, 'invalidJson') })
  }

  if (!parsed || typeof parsed !== 'object') return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  const { blockId } = parsed as Record<string, unknown>

  if (typeof blockId !== 'string') return send(res, 400, { error: t(lang, 'blockIdMissing') })

  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  if (entry.fixed) return send(res, 400, { error: t(lang, 'blockFixed') })

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  if (source.hash !== entry.fileHashAtRender) {
    return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  }

  // A single empty line right after end goes too (spec 5.6)
  const extraNewline = content[entry.end] === '\n' ? 1 : 0
  const patched = content.slice(0, entry.start) + content.slice(entry.end + extraNewline)

  try {
    const text = written(source, patched)
    await writeFile(entry.filePath, text, 'utf-8')
    await keepVersions(entry.filePath, source, text, 'delete')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }

  send(res, 200, { ok: true })
}

export async function handleMove(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  const ct = req.headers['content-type'] ?? ''
  if (ct.split(';')[0]!.trim().toLowerCase() !== 'application/json')
    return send(res, 415, { error: t(lang, 'contentTypeMustBeJson') })

  let parsed: unknown
  try {
    const body = await readBody(req, lang)
    parsed = JSON.parse(body)
  } catch {
    return send(res, 400, { error: t(lang, 'invalidJson') })
  }

  if (!parsed || typeof parsed !== 'object') return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  const { blockId, direction } = parsed as Record<string, unknown>

  if (typeof blockId !== 'string') return send(res, 400, { error: t(lang, 'blockIdMissing') })
  if (direction !== 'up' && direction !== 'down') return send(res, 400, { error: t(lang, 'directionInvalid') })

  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  if (entry.fixed) return send(res, 400, { error: t(lang, 'blockFixed') })

  // All blocks of the same file, by position; a page's head is no neighbour
  const fileEntries = [...blockIdMap.entries()]
    .filter(([, e]) => e.filePath === entry.filePath && !e.fixed)
    .sort(([, a], [, b]) => a.start - b.start)

  const idx = fileEntries.findIndex(([id]) => id === blockId)

  if (direction === 'up' && idx === 0) {
    return send(res, 400, { error: t(lang, 'firstBlockCannotMoveUp') })
  }
  if (direction === 'down' && idx === fileEntries.length - 1) {
    return send(res, 400, { error: t(lang, 'lastBlockCannotMoveDown') })
  }

  const [, neighborEntry] = fileEntries[direction === 'up' ? idx - 1 : idx + 1]

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  if (source.hash !== entry.fileHashAtRender) {
    return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  }

  // Atomic swap: lo and hi by position (spec 5.6)
  const lo = entry.start < neighborEntry.start ? entry : neighborEntry
  const hi = entry.start < neighborEntry.start ? neighborEntry : entry

  const loText = content.slice(lo.start, lo.end)
  const separator = content.slice(lo.end, hi.start) // the empty line between the blocks
  // the last block of a file without a final line end gets one, so the separator keeps the two blocks apart
  const hiBlock = content.slice(hi.start, hi.end)
  const hiText = hiBlock.endsWith('\n') ? hiBlock : hiBlock + '\n'

  const patched = content.slice(0, lo.start) + hiText + separator + loText + content.slice(hi.end)

  try {
    const text = written(source, patched)
    await writeFile(entry.filePath, text, 'utf-8')
    await keepVersions(entry.filePath, source, text, 'move')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }

  send(res, 200, { ok: true })
}

export async function handleMerge(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  const ct = req.headers['content-type'] ?? ''
  if (ct.split(';')[0]!.trim().toLowerCase() !== 'application/json')
    return send(res, 415, { error: t(lang, 'contentTypeMustBeJson') })

  let parsed: unknown
  try {
    const body = await readBody(req, lang)
    parsed = JSON.parse(body)
  } catch {
    return send(res, 400, { error: t(lang, 'invalidJson') })
  }

  if (!parsed || typeof parsed !== 'object') return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  const { blockId, direction } = parsed as Record<string, unknown>

  if (typeof blockId !== 'string') return send(res, 400, { error: t(lang, 'blockIdMissing') })
  if (direction !== 'up' && direction !== 'down') return send(res, 400, { error: t(lang, 'directionInvalid') })

  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  if (entry.fixed) return send(res, 400, { error: t(lang, 'blockFixed') })
  if (!entry.isParagraph) return send(res, 400, { error: t(lang, 'mergeOnlyForTextBlocks') })

  // a page's head is no neighbour
  const fileEntries = [...blockIdMap.entries()]
    .filter(([, e]) => e.filePath === entry.filePath && !e.fixed)
    .sort(([, a], [, b]) => a.start - b.start)

  const idx = fileEntries.findIndex(([id]) => id === blockId)

  if (direction === 'up' && idx === 0) {
    return send(res, 400, { error: t(lang, 'firstBlockHasNoPredecessor') })
  }
  if (direction === 'down' && idx === fileEntries.length - 1) {
    return send(res, 400, { error: t(lang, 'lastBlockHasNoSuccessor') })
  }

  const [, neighborEntry] = fileEntries[direction === 'up' ? idx - 1 : idx + 1]
  if (!neighborEntry.isParagraph) return send(res, 400, { error: t(lang, 'neighborNotTextBlock') })

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  if (source.hash !== entry.fileHashAtRender) {
    return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  }

  // lo = the upper block, hi = the lower one
  const lo = entry.start < neighborEntry.start ? entry : neighborEntry
  const hi = entry.start < neighborEntry.start ? neighborEntry : entry

  // Merge: drop lo's trailing \n, join with a soft break, append hi; content.slice(lo.end, hi.start), the separator (an
  // empty line), goes
  const loText = content.slice(lo.start, lo.end - 1) // without its trailing \n
  const hiText = content.slice(hi.start, hi.end) // with its trailing \n

  const merged = loText + '\n' + hiText
  const patched = content.slice(0, lo.start) + merged + content.slice(hi.end)

  try {
    const text = written(source, patched)
    await writeFile(entry.filePath, text, 'utf-8')
    await keepVersions(entry.filePath, source, text, 'merge')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }

  send(res, 200, { ok: true })
}
