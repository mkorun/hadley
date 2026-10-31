import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from '../index.ts'
import {
  getHighlighterCSS,
  getHighlightingCache,
  hasCode,
  highlightCode,
  initHighlighter,
  loadHighlightingCache,
  prepareHighlighter,
} from '../highlighter.ts'

// a code block in a list item in a quote
const doc = (code: string, lang: string) =>
  parseDocument(`> - Item\n>\n>   \`\`\`${lang}\n>   ${code}\n>   \`\`\`\n`, {})

after(() => initHighlighter(undefined))

describe('the Shiki theme', () => {
  test('is the one config.lima names, and its colours make the stylesheet', async () => {
    await initHighlighter('github-light')
    await prepareHighlighter([doc('const a = 1', 'typescript')])
    assert.match(highlightCode('const a = 1', 'typescript') ?? '', /<pre class="shiki github-light/)
    assert.ok(getHighlighterCSS().includes('background-color:#fff'))
  })

  test('starts its stylesheet anew when the theme changes', async () => {
    await initHighlighter('github-light')
    await prepareHighlighter([doc('let b = 2', 'typescript')])
    highlightCode('let b = 2', 'typescript')
    await initHighlighter('nord')
    assert.equal(getHighlighterCSS(), '')
    await prepareHighlighter([doc('let b = 2', 'typescript')])
    assert.match(highlightCode('let b = 2', 'typescript') ?? '', /<pre class="shiki nord/)
    assert.ok(getHighlighterCSS().includes('background-color:#2e3440'))
  })

  // hadley chose nord for a site that named no theme
  test('is not chosen by hadley: without one, a code block in a language stops the build', async () => {
    await initHighlighter(undefined)
    assert.equal(highlightCode('plain text', null), null)
    assert.throws(
      () => highlightCode('const a = 1', 'typescript'),
      /config\.lima: a code block in typescript needs highlighting\.theme, a Shiki theme/,
    )
  })

  test('is a theme Shiki has, or the build stops', async () => {
    await assert.rejects(
      initHighlighter('no-such-theme'),
      /config\.lima: highlighting\.theme no-such-theme is not a Shiki theme/,
    )
  })
})

describe('a light and a dark theme', () => {
  test('write each color as light-dark(), the light one first', async () => {
    await initHighlighter({ light: 'github-light', dark: 'github-dark-dimmed' })
    await prepareHighlighter([doc('const d = 4', 'typescript')])
    assert.match(
      highlightCode('const d = 4', 'typescript') ?? '',
      /<pre class="shiki shiki-themes github-light github-dark-dimmed/,
    )
    const css = getHighlighterCSS()
    assert.ok(css.includes('background-color:light-dark(#fff,#22272e)'), css)
    assert.ok(css.includes('color:light-dark(#D73A49,#F47067)'), css)
    assert.doesNotMatch(css, /--shiki/)
  })

  test('give a font style they set differently to the dark theme under prefers-color-scheme', async () => {
    await initHighlighter({ light: 'one-light', dark: 'one-dark-pro' })
    await prepareHighlighter([doc('*em* **b**', 'markdown')])
    highlightCode('*em* **b**', 'markdown')
    const css = getHighlighterCSS()
    assert.match(css, /\.sh-\w+\{color:light-dark\(#986801,#D19A66\);font-weight:bold\}/)
    assert.match(css, /@media \(prefers-color-scheme:dark\)\{\.sh-\w+\{font-weight:inherit\}\}/)
  })

  test('are each a theme Shiki has, or the build stops', async () => {
    await assert.rejects(
      initHighlighter({ light: 'github-light', dark: 'no-such-theme' }),
      /config\.lima: highlighting\.dark no-such-theme is not a Shiki theme/,
    )
  })

  test('keep a cache apart from a single theme', async () => {
    await initHighlighter({ light: 'github-light', dark: 'nord' })
    assert.equal(getHighlightingCache().theme, 'light:github-light dark:nord')
  })
})

describe('Shiki', () => {
  test('is loaded only for a code block the cache does not have, nested anywhere', async () => {
    await initHighlighter('nord')
    await prepareHighlighter([doc('const c = 3', 'typescript')])
    const html = highlightCode('const c = 3', 'typescript')
    const cache = getHighlightingCache()

    await initHighlighter('github-dark') // another theme unloads Shiki
    await initHighlighter('nord')
    loadHighlightingCache(cache)
    await prepareHighlighter([doc('const c = 3', 'typescript')])
    assert.equal(highlightCode('const c = 3', 'typescript'), html)
    assert.throws(
      () => highlightCode('const d = 4', 'typescript'),
      /highlightCode: prepareHighlighter\(\) was not given this typescript block/,
    )
  })

  // review 2026-10-26 (perf): the test kept Shiki loaded and never prepared the second build
  test('remembers a language it does not highlight, so that it is not loaded for it again', async () => {
    await initHighlighter('nord')
    await prepareHighlighter([doc('flowchart', 'mermaid')])
    assert.equal(highlightCode('flowchart', 'mermaid'), null)
    const cache = getHighlightingCache()
    await initHighlighter('github-dark') // another theme unloads Shiki
    await initHighlighter('nord')
    loadHighlightingCache(cache)
    await prepareHighlighter([doc('flowchart', 'mermaid')])
    assert.equal(highlightCode('flowchart', 'mermaid'), null)
    // Shiki was not loaded for it
    assert.throws(() => highlightCode('const e = 5', 'typescript'), /prepareHighlighter\(\) was not given/)
  })
})

// review 2026-10-26 (perf): the classes were numbered in the order blocks were met, and the stylesheet held every
// style the cache had ever seen
describe('the stylesheet of highlighted code', () => {
  const build = async (blocks: [code: string, lang: string][], cache?: ReturnType<typeof getHighlightingCache>) => {
    await initHighlighter('github-dark')
    await initHighlighter('nord')
    loadHighlightingCache(cache)
    await prepareHighlighter(blocks.map(([code, lang]) => doc(code, lang)))
    const html = blocks.map(([code, lang]) => highlightCode(code, lang))
    return { html, css: getHighlighterCSS(), cache: getHighlightingCache() }
  }

  test('names a style the same, whatever else a build highlights and in which order', async () => {
    const ts: [string, string] = ['const a: number = 1', 'typescript']
    const css: [string, string] = ['a { color: red }', 'css']
    const one = await build([ts, css])
    const other = await build([css, ts])
    assert.deepEqual(other.html, [one.html[1], one.html[0]])
    assert.equal(other.css, one.css)
    assert.equal((await build([ts])).html[0], one.html[0])
  })

  // review 2026-10-26 (dev server): the helper loaded Shiki anew for every build, so the stylesheet of a build that
  // takes its blocks from the cache, and the reset of one build to the next, went untested
  test('holds the styles of blocks taken from the cache, and starts empty for the next build of the same theme', async () => {
    const ts: [string, string] = ['const a: number = 1', 'typescript']
    const made = await build([ts])
    // Shiki not loaded: every block comes from the cache
    const cached = await build([ts], made.cache)
    assert.deepEqual(cached.html, made.html)
    assert.equal(cached.css, made.css)
    // the same theme, Shiki kept: a build of other code holds none of the earlier styles
    await prepareHighlighter([doc('x', 'mermaid')])
    loadHighlightingCache(made.cache)
    highlightCode('x', 'mermaid')
    assert.equal(getHighlighterCSS(), '')
  })

  test('holds the styles of the blocks this build shows, not those of the cache', async () => {
    const ts: [string, string] = ['const a: number = 1', 'typescript']
    const plain = await build([ts])
    assert.ok(plain.css.includes('{'))
    const later = await build([['Text', 'mermaid']], plain.cache)
    assert.equal(later.css, '')
  })
})

describe('a theme of the site’s theme (theme/highlighting/<name>.json)', () => {
  const own = (name: string, type: string, keyword: string) =>
    JSON.stringify({
      name,
      type,
      colors: {},
      tokenColors: [{ scope: ['keyword', 'storage'], settings: { foreground: keyword } }],
    })

  test('colours the code as a Shiki theme would, light and dark', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadley-own-theme-'))
    try {
      writeFileSync(join(dir, 'paper-light.json'), own('paper-light', 'light', '#A63A24'))
      writeFileSync(join(dir, 'paper-dark.json'), own('paper-dark', 'dark', '#E8806A'))
      await initHighlighter({ light: 'paper-light', dark: 'paper-dark' }, dir)
      await prepareHighlighter([doc('const e = 5', 'typescript')])
      highlightCode('const e = 5', 'typescript')
      assert.match(getHighlighterCSS(), /color:light-dark\(#A63A24,#E8806A\)/)
      assert.match(getHighlightingCache().theme ?? '', /^light:paper-light#[0-9a-f]{12} dark:paper-dark#[0-9a-f]{12}$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is named as its file is, and is light or dark; the build stops otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadley-own-theme-'))
    try {
      writeFileSync(join(dir, 'odd.json'), own('other', 'light', '#000000'))
      await assert.rejects(initHighlighter('odd', dir), /odd\.json: its name is "other", not odd/)
      await assert.rejects(initHighlighter('missing', dir), /neither a Shiki theme .* nor .*missing\.json/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// 2026-10-29: a theme linked syntax-highlighting.css on every page, an empty file on a site without code
describe('whether a page has code', () => {
  test('is a code block that names its language, nested too', () => {
    assert.equal(hasCode(doc('const a = 1', 'js')), true)
    assert.equal(hasCode(parseDocument('Text with `inline` code.\n\n```\nplain\n```\n', {})), false)
  })
})
