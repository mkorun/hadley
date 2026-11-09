// Whether the dev server runs older code than lies on the disk (lib/code-stamp.ts; Michael, 2026-11-09: a route that
// came after its start answered "not found"): a standing warning above the pill asks the author to restart it, at
// each load and after each change in place.
import { T, withLang } from '../core/texts.ts'

/** Asks the dev server; `warn` shows the warning, or takes it away. */
export async function checkServerCode(warn: (text: string | null) => void): Promise<void> {
  try {
    const res = await fetch(withLang('/__hadley/stale'), { cache: 'no-store' })
    // an older server knows no such route: older code, by its very answer
    if (res.status === 404) return warn(T.serverStale)
    const data = (await res.json()) as { stale?: unknown }
    warn(data.stale === true ? T.serverStale : null)
  } catch {
    // no answer: nothing to say
  }
}
