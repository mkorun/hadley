// The transport the features share; what an answer means, each feature reads itself (no 409 means the same twice).
import { T, withLang } from './texts.ts'

/** A POST of `body` as JSON to a /__hadley/* path, in the editor's language; each caller reads its answer itself. */
export const post = (path: string, body: unknown): Promise<Response> =>
  fetch(withLang(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** A response's JSON as an object, or an empty one where it has none. */
export const answer = async (res: Response): Promise<Record<string, unknown>> => {
  const data: unknown = await res.json().catch(() => ({}))
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
}

/** A message the server sent (`error`), or the unknown error's. */
export const serverError = (data: Record<string, unknown>): string =>
  typeof data['error'] === 'string' ? data['error'] : T.unknownError
