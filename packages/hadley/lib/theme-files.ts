/**
 * The files a theme publishes, decided before anything is built: the output path of each, the name it is written
 * under and, where hadley makes them, its bytes. A publish build minifies every stylesheet and script and writes it
 * under a name that carries the hash of its bytes; a dev build writes every file under its own name. Templates read
 * the names as `assets` (assetsFor), content's site paths resolve to them (lib/build-files.ts), and writeTheme()
 * writes the files. Nothing renames or rewrites a file once it is written, so a stylesheet or script imports no other
 * of the theme's: a publish build would rename the one it imports (themeImports).
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Output } from './output.ts'
import { isSystemFile, slashed } from './platform.ts'

export interface ThemeFile {
  source: string // its path in theme/
  name: string // its path in the output directory
  bytes?: string // what hadley made of the source; without, the source is copied as it is
}

/**
 * The files a theme publishes, by the path in the output directory they are published at: every file of `theme/`
 * but `templates/`, `i18n/`, `highlighting/` and `theme.lima`, a file of `static/` at the root, a TypeScript file
 * as the JavaScript it is compiled to. Maps each output path to its source path; two sources for one output path
 * stop the build.
 */
export async function themeOutputs(themeDir: string): Promise<Map<string, string>> {
  const outputs = new Map<string, string>()
  for (const source of (await readdir(themeDir, { recursive: true })).map((name) => slashed(name)).sort()) {
    const top = source.split('/')[0]
    if (source.split('/').some(isSystemFile)) continue
    if (top === 'templates' || top === 'i18n' || top === 'highlighting' || source === 'theme.lima') continue
    if (!(await stat(join(themeDir, source))).isFile()) continue
    const output = (top === 'static' ? source.slice('static/'.length) : source).replace(/\.ts$/, '.js')
    const other = outputs.get(output)
    if (other !== undefined) throw new Error(`theme: ${other} and ${source} are both published as ${output}`)
    outputs.set(output, source)
  }
  return outputs
}

/** A stylesheet or script hadley makes, as a publish build writes it: minified, under the hash of its bytes. */
export async function published(output: string, code: string): Promise<{ name: string; bytes: string }> {
  const { transform } = await import('esbuild')
  const css = output.endsWith('.css')
  const { code: bytes } = await transform(code, { loader: css ? 'css' : 'js', minify: true })
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  return { name: output.replace(css ? /\.css$/ : /\.js$/, () => `.${hash}${css ? '.css' : '.js'}`), bytes }
}

/**
 * What each stylesheet and script of `files` (paths in `dir`) imports from the site (`@import`, `import`, `import()`,
 * `require`), as esbuild reads it, by file; a URL with a scheme is another site's. A file it shows (`url()`) is not an
 * import. An import whose path a script computes (`import(p)`) esbuild cannot read, so it passes: the theme is
 * trusted like code (AGENTS.md, "Security"), and its author keeps to what this check can see, until the theme step
 * bundles.
 */
export async function themeImports(dir: string, files: readonly string[]): Promise<Map<string, string[]>> {
  if (files.length === 0) return new Map()
  const { build } = await import('esbuild')
  const imports = new Map<string, string[]>(files.map((file) => [resolve(dir, file), []]))
  const IMPORTS = new Set(['import-statement', 'import-rule', 'dynamic-import', 'require-call', 'composes-from'])
  await build({
    entryPoints: [...imports.keys()],
    // its own directory, not the one esbuild started in, which a caller may have left
    absWorkingDir: resolve(dir),
    bundle: true,
    format: 'esm', // a theme's script is a module
    outdir: 'out', // none is written
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'imports',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') return undefined
            if (IMPORTS.has(args.kind) && !/^[a-z][a-z0-9+.-]*:/i.test(args.path))
              imports.get(args.importer)!.push(args.path)
            return { path: args.path, external: true }
          })
        },
      },
    ],
  })
  return new Map(files.map((file) => [file, imports.get(resolve(dir, file))!]))
}

// Pagefind's files, which the search writes under the names Pagefind gives them (lib/search.ts): a script imports
// /pagefind/pagefind.js for Pagefind's search API
const PAGEFIND = /^\/pagefind\//

/**
 * What the theme in `themeDir` publishes, by output path, with the names and bytes `publish` decides. A stylesheet
 * or script that imports another file of the site stops the build, in either kind: published one by one under the
 * hash of their bytes, the file it imports would not be there under the name it imports. Pagefind's files keep
 * their names (PAGEFIND).
 */
export async function planTheme(themeDir: string, publish: boolean): Promise<Map<string, ThemeFile>> {
  const sources = await themeOutputs(themeDir)
  const faults: string[] = []
  const code = [...sources.values()].filter((source) => /\.(css|js|ts)$/.test(source))
  for (const [source, names] of await themeImports(themeDir, code)) {
    for (const name of names.filter((name) => !PAGEFIND.test(name)))
      faults.push(`theme/${source} imports ${name}; link each stylesheet and script from a template (assets[…])`)
  }
  if (faults.length > 0) throw new Error(faults.join('\n'))
  const files = new Map<string, ThemeFile>()
  for (const [output, source] of sources) {
    const typescript = source.endsWith('.ts')
    if (!publish || !(typescript || /\.(css|js)$/.test(output))) {
      files.set(output, { source, name: output })
      continue
    }
    const text = await readFile(join(themeDir, source), 'utf-8')
    files.set(output, { source, ...(await published(output, typescript ? await compile(text) : text)) })
  }
  return files
}

/**
 * Writes the theme's files where the plan claimed them. A dev build (`incremental`) leaves a copy written after its
 * source last changed (its ctime); returns how many files it wrote.
 */
export async function writeTheme(
  themeDir: string,
  files: ReadonlyMap<string, ThemeFile>,
  output: Output,
  incremental: boolean,
): Promise<number> {
  let written = 0
  for (const file of files.values()) {
    const sourceFile = join(themeDir, file.source)
    const destFile = output.claim(file.name, `theme: ${file.source}`)
    if (incremental) {
      const copy = await stat(destFile).catch(() => undefined)
      if (copy && copy.mtimeMs > (await stat(sourceFile)).ctimeMs) continue
    }
    await mkdir(dirname(destFile), { recursive: true })
    if (file.bytes !== undefined) await writeFile(destFile, file.bytes)
    else if (file.source.endsWith('.ts')) await writeFile(destFile, await compile(await readFile(sourceFile, 'utf-8')))
    else await copyFile(sourceFile, destFile)
    written++
  }
  return written
}

/**
 * What templates read as `assets`: by a file's output path as a URL path (`/assets/css/style.css`), the URL path
 * it is written under. A template that asks for a file nobody writes stops the build.
 */
export function assetsFor(names: ReadonlyMap<string, string>): Readonly<Record<string, string>> {
  const assets: Record<string, string> = {}
  for (const [output, name] of names) assets[`/${output}`] = `/${urlOf(name)}`
  return new Proxy(assets, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !Object.hasOwn(target, key))
        throw new Error(`assets has no file ${JSON.stringify(key)}: neither the theme nor hadley writes one there`)
      return Reflect.get(target, key, receiver)
    },
  })
}

/** A path in the output directory as a URL path: each segment percent-encoded. */
export const urlOf = (name: string): string => name.split('/').map(encodeURIComponent).join('/')

async function compile(typescript: string): Promise<string> {
  const { transform } = await import('esbuild')
  return (await transform(typescript, { loader: 'ts' })).code
}
