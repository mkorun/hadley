// The routes of the time machine (addons/editor/history-routes.ts), as the versions card asks them: each answer is
// what it holds, or the message to show.
import type { Change } from '../../core/changes.ts'
import { answer, post, serverError } from '../../core/request.ts'
import { T, withLang } from '../../core/texts.ts'

export interface Version extends Change {
  hash: string
  name?: string
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }

async function asked<T>(request: Promise<Response>, read: (data: Record<string, unknown>) => T): Promise<Answer<T>> {
  let res: Response
  try {
    res = await request
  } catch {
    return { ok: false, error: T.connectionFailedDev }
  }
  const data = await answer(res)
  return res.ok ? { ok: true, value: read(data) } : { ok: false, error: serverError(data), status: res.status }
}

const query = (path: string, more = ''): string => `?path=${encodeURIComponent(path)}${more}`
const get = (url: string): Promise<Response> => fetch(withLang(url), { cache: 'no-store' })

/** The page's versions, newest first, and the hash of its file as it is. */
/** The page's versions, newest first, the hash of its file as it is, and the version it stands at (undo, redo). */
export const listVersions = (
  path: string,
): Promise<Answer<{ current: string; at: number | undefined; versions: Version[] }>> =>
  asked(get(`/__hadley/history${query(path)}`), (data) => ({
    current: typeof data['current'] === 'string' ? data['current'] : '',
    at: typeof data['at'] === 'number' ? data['at'] : undefined,
    versions: Array.isArray(data['versions']) ? (data['versions'] as Version[]) : [],
  }))

/** The text of a version, or undefined where the log names it no more. */
export async function versionText(path: string, hash: string): Promise<string | undefined> {
  const got = await asked(get(`/__hadley/history/version${query(path, `&hash=${hash}`)}`), (data) => data['text'])
  return got.ok && typeof got.value === 'string' ? got.value : undefined
}

/** Brings `version` back, only onto the page of `current` (else status 409). */
export const restoreVersion = (path: string, version: Version, current: string): Promise<Answer<true>> =>
  asked(post('/__hadley/history/restore', { path, hash: version.hash, current }), () => true as const)

/** Keeps `version` under `name`, or takes its name with ''. */
export const keepVersion = (path: string, version: Version, name: string): Promise<Answer<true>> =>
  asked(post('/__hadley/history/name', { path, hash: version.hash, at: version.at, name }), () => true as const)

export const deleteVersion = (path: string, version: Version): Promise<Answer<true>> =>
  asked(post('/__hadley/history/delete', { path, hash: version.hash, at: version.at }), () => true as const)

/** Deletes every unnamed version but the page as it is; how many went. */
export const deleteUnnamed = (path: string): Promise<Answer<number>> =>
  asked(post('/__hadley/history/delete', { path, unnamed: true }), (data) =>
    typeof data['removed'] === 'number' ? data['removed'] : 0,
  )
