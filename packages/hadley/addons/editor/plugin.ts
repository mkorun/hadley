import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument, checkOnlyEditedBlockChanged } from '../../case/index.ts'
import { lf } from '../../lib/platform.ts'
import { resolveLang, t, type Lang } from './i18n.ts'

const assetsDir = join(fileURLToPath(new URL('.', import.meta.url)), 'assets')

export interface BlockMapEntry {
  filePath: string
  start: number // JS string index in the whole file (front matter and H1 included)
  end: number // exclusive: the position after the closing \n
  fileHashAtRender: string
  isParagraph?: boolean
}

// The server's map: blockId → source file and offsets. Every build fills it anew (registerPageBlocks drops a file's
// old entries).
export const blockIdMap = new Map<string, BlockMapEntry>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A file as the editor edits it: its text with LF line ends, and the hash of what was read. */
interface Source {
  content: string
  hash: string
  crlf: boolean // the file has CRLF throughout, and gets it back on writing
}

/**
 * The block offsets count one character for a line end (renderer.ts), so the editor edits a file with CRLF line ends
 * in LF and writes it back with CRLF. A file that mixes line ends could not be written back as it was: it is refused.
 */
async function readSource(filePath: string): Promise<Source | 'unreadable' | 'mixed'> {
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
const written = (source: Source, text: string): string => (source.crlf ? text.replace(/\n/g, '\r\n') : text)

// The language comes from the client as the query parameter `?lang=` (see i18n.ts), alike for GET and POST, however
// far the JSON body could be parsed.
function getLang(req: IncomingMessage): Lang {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return resolveLang(url.searchParams.get('lang'))
}

// The writes wait for each other (oneAtATime), so a body that never ends must not hold the ones after it
export async function readBody(
  req: IncomingMessage,
  lang: Lang,
  maxBytes = 1_048_576,
  maxMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    const late = setTimeout(() => {
      reject(new Error(t(lang, 'requestBodyTooSlow')))
      req.destroy()
    }, maxMs)
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        clearTimeout(late)
        reject(new Error(t(lang, 'requestBodyTooLarge')))
        req.destroy()
      } else {
        data += chunk.toString('utf-8')
      }
    })
    req.on('end', () => {
      clearTimeout(late)
      resolve(data)
    })
    req.on('error', (error) => {
      clearTimeout(late)
      reject(error)
    })
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(json)
}

// ─── Request-Handler ──────────────────────────────────────────────────────────

async function serveAsset(res: ServerResponse, filename: string, contentType: string, lang: Lang): Promise<void> {
  try {
    const content = await readFile(join(assetsDir, filename), 'utf-8')
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'no-store')
    res.end(content)
  } catch {
    send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${filename}` })
  }
}

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
  send(res, 200, { text })
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
  const { blockId, newText } = parsed as Record<string, unknown>

  // Check the required fields before reading the map (spec 5.5)
  if (typeof blockId !== 'string') return send(res, 400, { error: t(lang, 'blockIdMissing') })
  if (typeof newText !== 'string') return send(res, 400, { error: t(lang, 'newTextMissing') })

  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })

  const source = await readSource(entry.filePath)
  if (source === 'unreadable') return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  if (source === 'mixed') return send(res, 422, { error: t(lang, 'mixedLineEnds') })
  const { content } = source

  // Hash check: no blind overwrite after a concurrent edit (spec 5.5, ADR-7)
  if (source.hash !== entry.fileHashAtRender) {
    return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  }

  // Normalise the trailing \n: a textarea value can end with \n, which would make \n\n. A lone \r is no line end the
  // file could get back: before a \n it would be one, \r\r\n in a file with CRLF
  const text = lf(newText)
  if (text.includes('\r')) return send(res, 422, { error: t(lang, 'loneCarriageReturn') })
  const normalizedText = text.replace(/\n+$/, '')
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

  try {
    await writeFile(entry.filePath, written(source, patched), 'utf-8')
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
    await writeFile(entry.filePath, written(source, patched), 'utf-8')
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

  // All blocks of the same file, by position
  const fileEntries = [...blockIdMap.entries()]
    .filter(([, e]) => e.filePath === entry.filePath)
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
    await writeFile(entry.filePath, written(source, patched), 'utf-8')
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
  if (!entry.isParagraph) return send(res, 400, { error: t(lang, 'mergeOnlyForTextBlocks') })

  const fileEntries = [...blockIdMap.entries()]
    .filter(([, e]) => e.filePath === entry.filePath)
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
    await writeFile(entry.filePath, written(source, patched), 'utf-8')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }

  send(res, 200, { ok: true })
}

// ─── Vite-Plugin ──────────────────────────────────────────────────────────────

// The editor's writes one after another: each reads its file, checks the hash and writes before the next reads, so two
// changes at once cannot both pass the check and the second write over the first (review 2026-10-29)
let writing: Promise<unknown> = Promise.resolve()
export function oneAtATime(write: () => Promise<void>): Promise<void> {
  const run = writing.then(write)
  writing = run.catch(() => undefined)
  return run
}

export function blockEditorPlugin(): Plugin {
  return {
    name: 'hadley-block-editor',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__hadley/')) return next()

        const method = req.method ?? 'GET'
        const lang = getLang(req)

        let handler: Promise<void> | null = null

        if (method === 'GET' && url === '/__hadley/editor.js') {
          handler = serveAsset(res, 'editor.js', 'application/javascript; charset=utf-8', lang)
        } else if (method === 'GET' && url === '/__hadley/editor.css') {
          handler = serveAsset(res, 'editor.css', 'text/css; charset=utf-8', lang)
        } else if (method === 'GET' && url.startsWith('/__hadley/block/')) {
          handler = handleGet(req, res)
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/patch') {
          handler = oneAtATime(() => handlePatch(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/delete') {
          handler = oneAtATime(() => handleDelete(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/move') {
          handler = oneAtATime(() => handleMove(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/merge') {
          handler = oneAtATime(() => handleMerge(req, res))
        }

        if (handler) {
          handler.catch((err) => {
            if (!res.headersSent) send(res, 500, { error: String(err) })
          })
        } else {
          send(res, 404, { error: t(lang, 'notFound') })
        }
      })
    },
  }
}
