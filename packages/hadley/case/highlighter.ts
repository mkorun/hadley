/**
 * highlighter.ts — Shiki for code blocks, loaded only when a code block is not in the cache.
 *
 * The cycle (hadley's index.ts):
 *   await initHighlighter(themes)                         // config.lima `highlighting`; hadley chooses none
 *   loadHighlightingCache(JSON.parse(await readFile(cachePath)))  // or undefined, without a cache file
 *   await prepareHighlighter(docs)                        // loads Shiki if a code block is not in the cache
 *   ... render: highlightCode() is synchronous ...
 *   if (isHighlightingCacheModified()) await writeFile(cachePath, JSON.stringify(getHighlightingCache()))
 *
 * getHighlighterCSS() returns the classes of the blocks this build highlighted, for syntax-highlighting.css; a class is
 * named by the hash of its style, so a block reads the same in every build. With a light and a dark theme, a color is
 * written as light-dark(), which follows the page's color-scheme; a font style, weight or underline the two themes
 * set differently cannot be, and follows the reader's system (prefers-color-scheme).
 */

import { bundledThemes } from 'shiki/themes'
import type { Highlighter, ThemeRegistration } from 'shiki'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ParsedDocument } from './index.ts'
import { treeOf } from './destination.ts'

/** config.lima `highlighting`: one Shiki theme, or a light and a dark one. */
export type Themes = string | { light: string; dark: string }

let THEMES: Themes | undefined
// the themes a site's theme brings (theme/highlighting/<name>.json), by name, with the hash of their file
let _own = new Map<string, { theme: ThemeRegistration; hash: string }>()
// a theme as the cache file names it: by its name, and one of the site's theme also by its file's hash, so that a
// changed file is a changed theme
const cacheName = (name: string) => (_own.has(name) ? `${name}#${_own.get(name)!.hash}` : name)
// the themes as the cache file names them: a single theme by its name, as before there were two
const nameOf = (themes: Themes | undefined) =>
  typeof themes === 'object'
    ? `light:${cacheName(themes.light)} dark:${cacheName(themes.dark)}`
    : themes && cacheName(themes)

/** A theme the site's theme brings: a Shiki theme (TextMate JSON) named as its file is, light or dark. */
async function ownTheme(dir: string, key: string, name: string): Promise<{ theme: ThemeRegistration; hash: string }> {
  const path = join(dir, `${name}.json`)
  const text = await readFile(path, 'utf-8').catch(() => {
    throw new Error(
      `config.lima: highlighting.${key} ${name} is neither a Shiki theme (https://shiki.style/themes) nor ${path}`,
    )
  })
  let theme: ThemeRegistration
  try {
    theme = JSON.parse(text) as ThemeRegistration
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (theme.name !== name) throw new Error(`${path}: its name is ${JSON.stringify(theme.name)}, not ${name}`)
  if (theme.type !== 'light' && theme.type !== 'dark') throw new Error(`${path}: its type is light or dark`)
  return { theme, hash: createHash('sha256').update(text).digest('hex').slice(0, 12) }
}

let _shiki: Highlighter | null = null

// a highlighted block: its <pre>…</pre>, or '' for a language Shiki does not highlight here, and the styles of its
// classes; by language and the hash of its code
type Block = { html: string; styles: string[] }
let _blocks = new Map<string, Block>()
let _cacheModified = false
// the styles of the blocks this build showed, for its stylesheet
let _used = new Set<string>()

export type HighlightCacheFile = {
  theme: string | undefined
  blocks: Record<string, Block>
}

// a style's class, by the hash of the style: the same in every build, whatever else it highlights
const classOf = (style: string) => `sh-${createHash('sha256').update(style).digest('hex').slice(0, 8)}`

const LANGS = [
  'typescript',
  'javascript',
  'css',
  'html',
  'xml',
  'json',
  'bash',
  'markdown',
  'go',
  'rust',
  'python',
  'sql',
  'yaml',
  'java',
  'swift',
  'elixir',
  'ini',
  'powershell',
  'perl',
  'regex',
  'regexp',
] as const

/**
 * The themes of config.lima `highlighting`: each one of Shiki's, or one the site's theme brings in `ownDir`
 * (theme/highlighting/), as <name>.json.
 */
export async function initHighlighter(themes: Themes | undefined, ownDir?: string): Promise<void> {
  const named = typeof themes === 'object' ? { light: themes.light, dark: themes.dark } : { theme: themes }
  const before = nameOf(THEMES)
  const own = new Map<string, { theme: ThemeRegistration; hash: string }>()
  for (const [key, theme] of Object.entries(named)) {
    if (theme === undefined || Object.hasOwn(bundledThemes, theme)) continue
    if (ownDir === undefined)
      throw new Error(`config.lima: highlighting.${key} ${theme} is not a Shiki theme (https://shiki.style/themes)`)
    own.set(theme, await ownTheme(ownDir, key, theme))
  }
  _own = own
  if (_shiki && nameOf(themes) === before) return
  THEMES = themes
  _blocks = new Map()
  _used = new Set()
  _shiki = null
}

const keyOf = (code: string, lang: string) =>
  `${lang === 'lima' ? 'yaml' : lang}::${createHash('sha256').update(code).digest('hex').slice(0, 12)}`

// the code blocks of a document, wherever they are nested
function codeBlocks(node: unknown, found: { value: string; lang: string }[] = []) {
  if (Array.isArray(node)) for (const child of node) codeBlocks(child, found)
  else if (node !== null && typeof node === 'object') {
    const block = node as { type?: unknown; value?: unknown; lang?: unknown }
    if (block.type === 'codeBlock' && typeof block.lang === 'string' && typeof block.value === 'string')
      found.push({ value: block.value, lang: block.lang })
    else for (const child of Object.values(node)) codeBlocks(child, found)
  }
  return found
}

/** Whether `doc` has a code block that names its language, which syntax-highlighting.css colours. */
export const hasCode = (doc: ParsedDocument): boolean => codeBlocks(treeOf(doc.parsed)).length > 0

/** Loads Shiki, with every language it highlights here, when a code block of `docs` is not in the cache. */
export async function prepareHighlighter(docs: readonly ParsedDocument[]): Promise<void> {
  if (_shiki || THEMES === undefined) return
  const missing = docs.some((doc) =>
    codeBlocks(treeOf(doc.parsed)).some(({ value, lang }) => !_blocks.has(keyOf(value, lang))),
  )
  if (!missing) return
  const { createHighlighter } = await import('shiki')
  const names = typeof THEMES === 'object' ? [THEMES.light, THEMES.dark] : [THEMES]
  const themes = names.map((name) => _own.get(name)?.theme ?? name)
  _shiki = await createHighlighter({ themes, langs: [...LANGS] })
}

/**
 * The cache a build starts from: its file's, or none without one, of another theme or of an earlier form, whatever
 * was built before. The build's stylesheet starts empty.
 */
export function loadHighlightingCache(data: HighlightCacheFile | undefined): void {
  const kept = data?.theme === nameOf(THEMES) && data?.blocks ? data.blocks : {}
  _blocks = new Map(Object.entries(kept))
  _used = new Set()
  _cacheModified = false
}

export function getHighlightingCache(): HighlightCacheFile {
  return { theme: nameOf(THEMES), blocks: Object.fromEntries(_blocks) }
}

export function isHighlightingCacheModified(): boolean {
  return _cacheModified
}

/**
 * The block's <pre><code>…</code></pre>, or null for a language Shiki does not highlight here: the renderer then
 * writes the code as text. 'lima' is highlighted as 'yaml'.
 */
export function highlightCode(code: string, lang: string | null): string | null {
  if (!lang) return null
  if (THEMES === undefined) {
    throw new Error(
      `config.lima: a code block in ${lang} needs highlighting.theme, a Shiki theme (https://shiki.style/themes)`,
    )
  }
  const key = keyOf(code, lang)
  let block = _blocks.get(key)
  if (!block) {
    if (!_shiki) throw new Error(`highlightCode: prepareHighlighter() was not given this ${lang} block`)
    const styles = new Set<string>()
    let html = ''
    try {
      const shikiLang = lang === 'lima' ? 'yaml' : lang
      const transformers = [styleToClass(styles)]
      html =
        typeof THEMES === 'object'
          ? _shiki.codeToHtml(code, { lang: shikiLang, themes: THEMES, defaultColor: false, transformers })
          : _shiki.codeToHtml(code, { lang: shikiLang, theme: THEMES, transformers })
    } catch {}
    block = { html, styles: html ? [...styles].sort() : [] }
    _blocks.set(key, block)
    _cacheModified = true
  }
  for (const style of block.styles) _used.add(style)
  return block.html || null
}

/** The classes of every block this build highlighted, sorted by class. */
export function getHighlighterCSS(): string {
  return [..._used]
    .map((style) => cssOf(classOf(style), style))
    .sort()
    .join('\n')
}

/**
 * A class's rule. A single theme's style is a rule as it is; two themes' is Shiki's --shiki-light… and --shiki-dark…
 * properties: a color and a background as light-dark(), anything else the same in both as it is, and else the
 * dark theme's under prefers-color-scheme: dark.
 */
function cssOf(name: string, style: string): string {
  if (!style.includes('--shiki-light')) return `.${name}{${style}}`
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  for (const declaration of style.split(';')) {
    const match = /^--shiki-(light|dark)(?:-(.+))?:(.+)$/.exec(declaration.trim())
    if (!match) continue
    const property = match[2] ?? 'color'
    ;(match[1] === 'light' ? light : dark).set(property === 'bg' ? 'background-color' : property, match[3]!)
  }
  const both: string[] = []
  const darkOnly: string[] = []
  for (const property of new Set([...light.keys(), ...dark.keys()])) {
    const l = light.get(property) ?? 'inherit'
    const d = dark.get(property) ?? 'inherit'
    if (property === 'color' || property === 'background-color') both.push(`${property}:light-dark(${l},${d})`)
    else if (l === d) both.push(`${property}:${l}`)
    else {
      both.push(`${property}:${l}`)
      darkOnly.push(`${property}:${d}`)
    }
  }
  const rule = `.${name}{${both.join(';')}}`
  return darkOnly.length ? `${rule}\n@media (prefers-color-scheme:dark){.${name}{${darkOnly.join(';')}}}` : rule
}

// ─── Style-to-class transformer ──────────────────────────────────────────────
// transformerStyleToClass of @shikijs/transformers uses the tokens hook and token.htmlStyle, which a single theme
// leaves empty; this one takes the style of the HAST nodes in the pre and span hooks, and notes it in `styles`.

function styleToClass(styles: Set<string>) {
  function toClass(this: any, node: any) {
    const style = node.properties?.style as string | undefined
    if (!style) return
    styles.add(style)
    delete node.properties.style
    // addClassToHast is a Shiki transformer context utility not reflected in the public type
    this.addClassToHast(node, classOf(style))
  }
  return { name: 'hadley:style-to-class', pre: toClass, span: toClass }
}
