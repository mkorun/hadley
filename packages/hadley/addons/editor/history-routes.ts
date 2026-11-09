/**
 * The routes of the time machine (history.ts), under `/__hadley/history`: the versions of a page, the text of one,
 * going back to one, and naming one. The page is named by its URL path; its file comes from the pages the build
 * registered (pageHeads), never from the browser, and a version only by a hash its log names. Undo and redo step
 * through them as an editor's stacks (history.ts, steps). Reads are a source read for lib/dev-guard.ts, as
 * `/__hadley/block/` is; writes go one at a time with the editor's (oneAtATime). Deleting takes one version or every
 * unnamed one, never the one the page stands at.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { siteHistory, undone, NAME_MAX, type Step } from './history.ts'
import { t, type Lang } from './i18n.ts'
import { pageHeads } from './blocks.ts'
import { readBody, send } from './http.ts'
import { oneAtATime } from './plugin.ts'

const HASH = /^[0-9a-f]{64}$/
const WRITES = new Set([
  '/__hadley/history/restore',
  '/__hadley/history/name',
  '/__hadley/history/delete',
  '/__hadley/history/step',
])

/** What a step would take back or bring back, for the button's title. */
const summary = (step: Step | undefined) =>
  step && {
    at: step.change.at,
    by: step.change.by,
    ...(step.change.what ? { what: step.change.what } : {}),
    ...(step.change.agent ? { agent: step.change.agent } : {}),
  }

const fileOf = (path: unknown): string | undefined =>
  typeof path === 'string' && path.startsWith('/') ? pageHeads.get(path)?.filePath : undefined

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Answers a request under /__hadley/history; false for any other path or method. */
export async function historyRoute(req: IncomingMessage, res: ServerResponse, lang: Lang): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const versions = siteHistory()
  if (!url.pathname.startsWith('/__hadley/history') || !versions) return false

  if (req.method === 'GET' && url.pathname === '/__hadley/history') {
    const file = fileOf(url.searchParams.get('path'))
    if (!file) return (send(res, 404, { error: t(lang, 'pageUnknown') }), true)
    const current = hashOf(await readFile(file, 'utf-8'))
    // the version the page stands at, which undo or redo may have moved from the newest
    const at = await versions.standing(file)
    const listed = await versions.list(file)
    // the versions undo took the page away from: the card shows them as undone
    const away = at === undefined ? [] : [...undone([...listed].reverse(), at)]
    send(res, 200, { current, at, undone: away, versions: listed })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/__hadley/history/steps') {
    const file = fileOf(url.searchParams.get('path'))
    if (!file) return (send(res, 404, { error: t(lang, 'pageUnknown') }), true)
    const current = hashOf(await readFile(file, 'utf-8'))
    const { undo, redo } = await versions.steps(file)
    send(res, 200, { current, ...(undo ? { undo: summary(undo) } : {}), ...(redo ? { redo: summary(redo) } : {}) })
    return true
  }
  if (req.method === 'GET' && url.pathname === '/__hadley/history/version') {
    const file = fileOf(url.searchParams.get('path'))
    if (!file) return (send(res, 404, { error: t(lang, 'pageUnknown') }), true)
    const text = await versions.content(file, url.searchParams.get('hash') ?? '')
    if (text === undefined) return (send(res, 404, { error: t(lang, 'versionUnknown') }), true)
    send(res, 200, { text })
    return true
  }
  if (req.method !== 'POST' || !WRITES.has(url.pathname)) return false

  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readBody(req, lang))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)
  }
  const file = fileOf(body['path'])
  if (!file) return (send(res, 404, { error: t(lang, 'pageUnknown') }), true)
  if (url.pathname === '/__hadley/history/step') {
    const way = body['way']
    const current = body['current']
    if ((way !== 'undo' && way !== 'redo') || typeof current !== 'string' || !HASH.test(current))
      return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)
    await oneAtATime(() => step(file, way, current, res, lang))
    return true
  }
  if (url.pathname === '/__hadley/history/delete' && body['unnamed'] === true) {
    send(res, 200, { removed: await versions.removeUnnamed(file) })
    return true
  }
  const hash = body['hash']
  if (typeof hash !== 'string' || !HASH.test(hash))
    return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)

  if (url.pathname === '/__hadley/history/name') {
    const name = body['name']
    const at = body['at']
    if (typeof name !== 'string' || name.length > NAME_MAX || (at !== undefined && typeof at !== 'number'))
      return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)
    if (!(await versions.name(file, hash, name, at)))
      return (send(res, 404, { error: t(lang, 'versionUnknown') }), true)
    send(res, 200, { ok: true })
    return true
  }
  if (url.pathname === '/__hadley/history/delete') {
    const at = body['at']
    if (typeof at !== 'number') return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)
    if (!(await versions.remove(file, at, hash))) return (send(res, 404, { error: t(lang, 'versionUnknown') }), true)
    send(res, 200, { ok: true })
    return true
  }

  // going back is a write as the editor's: one at a time, and only onto the page the panel showed
  const current = body['current']
  if (typeof current !== 'string' || !HASH.test(current))
    return (send(res, 400, { error: t(lang, 'invalidRequestBody') }), true)
  await oneAtATime(async () => {
    const text = await versions.content(file, hash)
    if (text === undefined) return send(res, 404, { error: t(lang, 'versionUnknown') })
    let now: string
    try {
      now = await readFile(file, 'utf-8')
    } catch {
      return send(res, 500, { error: t(lang, 'couldNotReadFile') })
    }
    if (hashOf(now) !== current) return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
    // the page as it is stays a version: nothing is lost by going back, and where it cannot be kept, nothing is written
    // (review 2026-11-09: a restore overwrote a page no version held)
    try {
      await versions.record(file, now, 'outside')
    } catch {
      return send(res, 500, { error: t(lang, 'versionNotKept') })
    }
    try {
      await writeFile(file, text, 'utf-8')
    } catch {
      return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
    }
    // which version came back, for the card to name it (Michael, 2026-11-09)
    const from = body['at']
    await versions.record(file, text, 'restore', typeof from === 'number' ? { from } : {}).catch(() => undefined)
    send(res, 200, { ok: true })
  })
  return true
}

/**
 * Undo or redo (history.ts, steps): the version it leads to written to the file, as the editor writes; no version of
 * its own, the page stands at that one now; only onto the page the button was shown for.
 */
async function step(file: string, way: 'undo' | 'redo', current: string, res: ServerResponse, lang: Lang) {
  const versions = siteHistory()!
  let now: string
  try {
    now = await readFile(file, 'utf-8')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotReadFile') })
  }
  if (hashOf(now) !== current) return send(res, 409, { error: t(lang, 'fileChangedSinceOpen') })
  // the page as it is is a version first, as before restoring; where it cannot be kept, nothing is written
  try {
    await versions.record(file, now, 'outside')
  } catch {
    return send(res, 500, { error: t(lang, 'versionNotKept') })
  }
  const target = (await versions.steps(file))[way]?.target
  const text = target && (await versions.content(file, target.hash))
  if (!target || text === undefined) return send(res, 404, { error: t(lang, 'versionUnknown') })
  try {
    await writeFile(file, text, 'utf-8')
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }
  await versions.stand(file, target.at)
  send(res, 200, { ok: true })
}
