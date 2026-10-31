import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import compileTemplates, { compileHeading, rawProblems } from '../compile-templates.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-templates-test-'))
  mkdirSync(join(dir, 'partials'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const compile = () =>
  compileTemplates({ includes: { import: (path, enc) => readFile(path, enc as BufferEncoding), basedir: dir } })

describe('what a template writes as HTML', () => {
  it('is what hadley made as HTML (html.*) and the theme’s own texts (t.*)', () => {
    assert.deepEqual(rawProblems("{@raw html.markup} {@raw html.comments ?? ''} {@raw t.search.devNote}"), [])
  })

  // review 2026-10-23: a theme wrote meta.vgwort_pixel, a front-matter value, as HTML
  it('is not a value from the front matter, the site or anywhere else', () => {
    assert.deepEqual(rawProblems('{@raw meta.vgwort_pixel} {@raw markup} {@raw htmlish.x}'), [
      '{@raw meta.vgwort_pixel} writes a value as HTML; a template writes HTML only from html.* and t.*',
      '{@raw markup} writes a value as HTML; a template writes HTML only from html.* and t.*',
      '{@raw htmlish.x} writes a value as HTML; a template writes HTML only from html.* and t.*',
    ])
  })

  // review 2026-10-24: the rule read the spelling, so {@const html = meta} made a front-matter value html.*
  it('is html.* and t.* as hadley gives them: a template that binds either name is refused', () => {
    const problems = rawProblems(
      '{@const html = meta}{@raw html.x}{#each items as t, i}{/each}{#each items as x, html}{/each}' +
        '{#snippet t(v)}{/snippet}{#snippet s(html)}{@raw html.x}{/snippet}{#if a}{@raw meta.y}{/if}',
    )
    assert.deepEqual(problems, [
      '{@const html = meta} binds html, which hadley gives',
      '{#each items as t, i} binds t, which hadley gives',
      '{#each items as x, html} binds html, which hadley gives',
      '{#snippet t(v)} binds t, which hadley gives',
      '{#snippet s(html)} binds html, which hadley gives',
      '{@raw meta.y} writes a value as HTML; a template writes HTML only from html.* and t.*',
    ])
    assert.deepEqual(rawProblems("{@raw html[meta.key]} {@raw html.x ?? meta.y} {@raw html.x ?? ''}").length, 2)
  })

  it('stops compiling at a layout or a partial that writes another value as HTML', async () => {
    writeFileSync(join(dir, 'page.chase'), '<main>{@raw html.markup}</main>{@partial partials/foot.sort}')
    writeFileSync(join(dir, 'partials', 'foot.sort'), '<footer>{@raw site.footer}</footer>')
    await assert.rejects(compile(), /foot\.sort: \{@raw site\.footer\} writes a value as HTML/)
    writeFileSync(join(dir, 'partials', 'foot.sort'), '<footer>{ site.footer }</footer>')
    const templates = await compile()
    assert.equal(
      await templates.page!.render({ html: { markup: '<p>x</p>' }, site: { footer: '<b>' } }),
      '<main><p>x</p></main><footer>&lt;b&gt;</footer>',
    )
  })
})

describe('an error in a template', () => {
  // 2026-10-26: galley named every template <template>, so an error after parsing (G5005 of galley 0.4.0, here
  // {@js} without allowCode) did not say which file it was in; hadley's own {@raw} check parses with the name
  it('names the file it is in', async () => {
    writeFileSync(join(dir, 'article.chase'), '<p>{@js}return 1{@js}</p>\n')
    await assert.rejects(compile(), (error: Error) => {
      assert.match(error.message, /article\.chase:1:/)
      assert.doesNotMatch(error.message, /<template>/)
      return true
    })
  })
})

describe('a partial a template includes', () => {
  // review 2026-10-28 (C.5): a missing partial stopped the build with Node's ENOENT and its stack
  it('stops the build with its path when the theme has no such file', async () => {
    writeFileSync(join(dir, 'article.chase'), '{@partial partials/nope.sort}\n')
    await assert.rejects(
      compile(),
      /partials\/nope\.sort: the theme has no such template, which a \{@partial\} includes/,
    )
  })

  // the file systems of macOS and Windows find a name in any case; a theme built there must build on Linux too
  it('is found only as it is spelled, also where reading finds a name in any case', async () => {
    writeFileSync(join(dir, 'article.chase'), '{@partial partials/head.sort}\n')
    writeFileSync(join(dir, 'partials', 'Head.sort'), '<head></head>')
    const anyCase = async (path: string) => {
      const name = path.split('/').at(-1)!.toLowerCase()
      return readFile(join(dir, 'partials', name === 'head.sort' ? 'Head.sort' : name), 'utf-8').catch(() =>
        readFile(path, 'utf-8'),
      )
    }
    await assert.rejects(
      compileTemplates({ includes: { import: anyCase, basedir: dir } }),
      /partials\/head\.sort: the theme has no such template, which a \{@partial\} includes/,
    )
    writeFileSync(join(dir, 'article.chase'), '{@partial partials/Head.sort}\n')
    await compileTemplates({ includes: { import: anyCase, basedir: dir } })
  })
})

describe('the heading template (templates/markup/heading.sort)', () => {
  const heading = () =>
    compileHeading({ includes: { import: (path, enc) => readFile(path, enc as BufferEncoding), basedir: dir } })

  it('is none for a theme without it', async () => {
    assert.equal(await heading(), undefined)
  })

  it('writes the heading’s content as html.text, and its anchor', async () => {
    mkdirSync(join(dir, 'markup'))
    writeFileSync(join(dir, 'markup', 'heading.sort'), '{@raw html.text}{#if id} <a href="#{ id }">¶</a>{/if}')
    const template = await heading()
    assert.equal(
      template?.render({ html: { text: 'A <em>b</em>' }, id: 'a-b' }, {}),
      'A <em>b</em> <a href="#a-b">¶</a>',
    )
  })

  it('writes no other value as HTML', async () => {
    mkdirSync(join(dir, 'markup'))
    writeFileSync(join(dir, 'markup', 'heading.sort'), '{@raw id}')
    await assert.rejects(heading(), /heading\.sort: \{@raw id\} writes a value as HTML/)
  })
})
