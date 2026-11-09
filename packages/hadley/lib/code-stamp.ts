/**
 * Whether hadley's own code changed since the dev server started (Michael, 2026-11-09: a route that came after the
 * start answered "not found", and nothing said why). The code the server loads once, at its start: the TypeScript of
 * the package, but for what it reads anew for each request (the editor's browser code, the chat's assets), tests,
 * starters and themes. Its stamp is the names, sizes and times of those files; a different one means: restart.
 */
import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
// read anew for each request, or not code the server runs
const SKIP = new Set(['node_modules', 'tests', 'starters', 'themes', 'browser', 'assets'])

/** The stamp of the code under `dir` the server loads once. */
export async function codeStamp(dir = PACKAGE): Promise<string> {
  const lines: string[] = []
  const walk = async (at: string): Promise<void> => {
    const entries = await readdir(at, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) await walk(path)
      } else if (entry.name.endsWith('.ts')) {
        const { size, mtimeMs } = await stat(path).catch(() => ({ size: -1, mtimeMs: 0 }))
        lines.push(`${relative(dir, path)} ${size} ${mtimeMs}`)
      }
    }
  }
  await walk(dir)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

// the stamp as the server started: taken when this module is first loaded, which the dev server does at its start
const started = codeStamp()

/** Whether hadley's code on the disk is no longer the code the dev server runs. */
export async function codeChanged(): Promise<boolean> {
  return (await codeStamp()) !== (await started)
}
