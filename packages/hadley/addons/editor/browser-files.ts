/**
 * The editor's browser code as the browser loads it, under `/__hadley/editor/` (plugin.ts): a module of browser/ in
 * TypeScript, which esbuild turns into JavaScript file by file, with its source map; and one stylesheet, which the CSS
 * files of browser/ make in the order of STYLES, unchanged, so that its cascade is theirs. Only names of browser/, and
 * only files that are still inside it once their links are resolved. A module is compiled once for each state of its
 * file, and requests that come while it is compiled wait for that one (review 2026-11-08, Astra: each request cost a
 * compile).
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const browserDir = join(fileURLToPath(new URL('.', import.meta.url)), 'browser')

/** The stylesheet's files in browser/, in the order of its cascade. */
export const STYLES: readonly string[] = [
  'tokens.css',
  'features/bar.css',
  'features/frames.css',
  'features/menu-trigger.css',
  'features/menu.css',
  'features/field.css',
  'features/files.css',
  'features/drawers.css',
  'features/pictures.css',
  'features/front-matter.css',
  'features/versions/versions.css',
  'features/undo.css',
  'features/dialog.css',
  'motion.css',
]

export const STYLESHEET = '/__hadley/editor/editor.css'
const MODULE = /^\/__hadley\/editor\/((?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts)$/

/** A file of browser/ by its real path, or undefined where there is none, or where its link leads out of browser/. */
async function inside(name: string, dir: string): Promise<string | undefined> {
  // an error names no path of this machine (review 2026-11-08, Astra)
  const root = await realpath(dir).catch(() => {
    throw new Error("the editor's browser code is missing")
  })
  const file = await realpath(join(dir, name)).catch(() => undefined)
  return file?.startsWith(root + sep) ? file : undefined
}

/** Each module as compiled, by its real path, with the state of its file then: size, times, inode. */
const compiled = new Map<string, { stamp: string; code: Promise<string> }>()

async function compile(file: string, path: string): Promise<string> {
  const { size, mtimeMs, ctimeMs, ino } = await stat(file)
  const stamp = `${size}:${mtimeMs}:${ctimeMs}:${ino}`
  const known = compiled.get(file)
  if (known?.stamp === stamp) return known.code
  const entry = {
    stamp,
    code: readFile(file, 'utf-8').then(async (source) => {
      const { transform } = await import('esbuild')
      return (await transform(source, { loader: 'ts', sourcemap: 'inline', sourcefile: path })).code
    }),
  }
  compiled.set(file, entry)
  // a module that does not compile is compiled anew at the next request
  entry.code.catch(() => compiled.get(file) === entry && compiled.delete(file))
  return entry.code
}

/** What `GET <path>` (without its query) answers, or undefined for no file of the editor's. */
export async function browserFile(
  path: string,
  dir = browserDir,
  styles = STYLES,
): Promise<{ type: string; body: string } | undefined> {
  if (path === STYLESHEET) {
    const files = await Promise.all(styles.map((name) => inside(name, dir)))
    const missing = styles.filter((_, i) => files[i] === undefined)
    if (missing.length > 0) throw new Error(`the editor's stylesheet lacks ${missing.join(', ')}`)
    const parts = await Promise.all(files.map((file) => readFile(file!, 'utf-8')))
    return { type: 'text/css; charset=utf-8', body: parts.join('\n') }
  }
  const name = MODULE.exec(path)?.[1]
  const file = name === undefined ? undefined : await inside(name, dir)
  if (file === undefined) return undefined
  return { type: 'application/javascript; charset=utf-8', body: await compile(file, path) }
}
