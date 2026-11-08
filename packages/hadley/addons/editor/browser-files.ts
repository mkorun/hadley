/**
 * The editor's browser code as the browser loads it, under `/__hadley/editor/` (plugin.ts): a module of browser/ in
 * TypeScript, which esbuild turns into JavaScript file by file, with its source map; and one stylesheet, which the CSS
 * files of browser/ make in the order of STYLES, unchanged, so that its cascade is theirs. Only names of browser/, and
 * only files that are still inside it once their links are resolved. The old editor (assets/) stays until the new one
 * does all it does (docs/dev-server.md, HADLEY_EDITOR).
 */
import { readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const browserDir = join(fileURLToPath(new URL('.', import.meta.url)), 'browser')

/** The stylesheet's files in browser/, in the order of its cascade: together, the old editor.css, byte for byte. */
export const STYLES: readonly string[] = [
  'tokens.css',
  'features/bar.css',
  'features/frames.css',
  'features/menu-trigger.css',
  'features/menu.css',
  'features/field.css',
  'features/files.css',
  'features/pictures.css',
  'features/front-matter.css',
  'features/dialog.css',
  'motion.css',
]

export const STYLESHEET = '/__hadley/editor/editor.css'
const MODULE = /^\/__hadley\/editor\/((?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts)$/

/** A file of browser/ by its name there, or undefined where there is none, or where its link leads out of browser/. */
async function readInside(name: string, dir: string): Promise<string | undefined> {
  const root = await realpath(dir)
  const file = await realpath(join(dir, name)).catch(() => undefined)
  return file?.startsWith(root + sep) ? readFile(file, 'utf-8') : undefined
}

/** What `GET <path>` (without its query) answers, or undefined for no file of the editor's. */
export async function browserFile(
  path: string,
  dir = browserDir,
  styles = STYLES,
): Promise<{ type: string; body: string } | undefined> {
  if (path === STYLESHEET) {
    const parts = await Promise.all(styles.map((name) => readInside(name, dir)))
    const missing = styles.filter((_, i) => parts[i] === undefined)
    if (missing.length > 0) throw new Error(`the editor's stylesheet lacks ${missing.join(', ')}`)
    return { type: 'text/css; charset=utf-8', body: parts.join('\n') }
  }
  const name = MODULE.exec(path)?.[1]
  const source = name === undefined ? undefined : await readInside(name, dir)
  if (source === undefined) return undefined
  const { transform } = await import('esbuild')
  const { code } = await transform(source, { loader: 'ts', sourcemap: 'inline', sourcefile: path })
  return { type: 'application/javascript; charset=utf-8', body: code }
}
