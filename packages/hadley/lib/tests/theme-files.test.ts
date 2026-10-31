import { afterEach, beforeEach, describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Output } from '../output.ts'
import { assetsFor, planTheme, themeOutputs, writeTheme } from '../theme-files.ts'

describe('themeOutputs', () => {
  let dir: string
  const file = (path: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), '')
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hadley-theme-outputs-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('publishes static/ at the root, TypeScript as JavaScript, and neither templates/ nor i18n/', async () => {
    for (const path of ['assets/a.css', 'assets/b.ts', 'static/favicon.png', 'templates/page.chase', 'i18n/de.lima'])
      file(path)
    assert.deepEqual(
      [...(await themeOutputs(dir))],
      [
        ['assets/a.css', 'assets/a.css'],
        ['assets/b.js', 'assets/b.ts'],
        ['favicon.png', 'static/favicon.png'],
      ],
    )
  })

  // review 2026-10-24 (follow-up): the map kept one of two sources for an output path; the copier never saw the other
  it('stops at two sources published under one path', async () => {
    for (const path of ['assets/x.js', 'assets/x.ts']) file(path)
    await assert.rejects(
      themeOutputs(dir),
      /theme: assets\/x\.js and assets\/x\.ts are both published as assets\/x\.js/,
    )
    rmSync(join(dir, 'assets', 'x.ts'))
    file('static/assets/x.js')
    await assert.rejects(
      themeOutputs(dir),
      /assets\/x\.js and static\/assets\/x\.js are both published as assets\/x\.js/,
    )
  })
})

describe('the theme files of a build', () => {
  let dir: string
  const file = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hadley-theme-files-test-'))
    file('assets/css/style.css', 'body {\n  color: red;\n}\n')
    file('assets/js/a.ts', 'const x: number = 1\nconsole.log(x)\n')
    file('static/favicon.png', 'png')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // review 2026-10-25: a stylesheet or script that imported another kept the name the publish build replaced
  it('stop a build of either kind at a stylesheet or script that imports another file of the site', async () => {
    file('assets/css/b.css', '.b { color: blue }\n')
    file(
      'assets/css/style.css',
      '@import "b.css";\n@import url("https://fonts.example/x.css");\nbody { background: url(../i.svg) }\n',
    )
    file(
      'assets/js/a.ts',
      'import { b } from "./b.js"\nimport type { T } from "./t.ts"\nconst c: T = b\nawait import("/assets/js/c.js")\n',
    )
    for (const publish of [true, false]) {
      await assert.rejects(planTheme(dir, publish), (error: Error) => {
        assert.deepEqual(error.message.split('\n'), [
          'theme/assets/css/style.css imports b.css; link each stylesheet and script from a template (assets[…])',
          'theme/assets/js/a.ts imports ./b.js; link each stylesheet and script from a template (assets[…])',
          'theme/assets/js/a.ts imports /assets/js/c.js; link each stylesheet and script from a template (assets[…])',
        ])
        return true
      })
    }
  })

  // CI on macOS 2026-10-31: its temporary directory is reached through a symbolic link, which esbuild resolves
  it('read the imports of a theme reached through a symbolic link', async () => {
    file('assets/css/b.css', '.b { color: blue }\n')
    file('assets/css/style.css', '@import "b.css";\n')
    const link = `${dir}-link`
    symlinkSync(dir, link, 'junction')
    try {
      await assert.rejects(planTheme(link, true), {
        message:
          'theme/assets/css/style.css imports b.css; link each stylesheet and script from a template (assets[…])',
      })
    } finally {
      rmSync(link, { force: true })
    }
  })

  it("let a script import Pagefind's search API, which keeps its name", async () => {
    file('assets/js/search.js', 'const pagefind = await import("/pagefind/pagefind.js")\nawait pagefind.init()\n')
    assert.ok((await planTheme(dir, true)).has('assets/js/search.js'))
  })

  it('let a stylesheet import another site and show files with url()', async () => {
    file('assets/css/style.css', '@import url("https://fonts.example/x.css");\nbody { background: url(../i.svg) }\n')
    assert.ok((await planTheme(dir, true)).has('assets/css/style.css'))
  })

  // review 2026-10-24 (Fable): deploy renamed the finished files and rewrote every HTML file that named one
  it('are named by the hash of their minified bytes in a publish build, before anything is written', async () => {
    const files = await planTheme(dir, true)
    // review 2026-10-26 (href): the shape of the name alone passed with a hash of nothing
    const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    assert.equal(files.get('assets/css/style.css')!.bytes, 'body{color:red}\n')
    assert.equal(files.get('assets/css/style.css')!.name, `assets/css/style.${hash('body{color:red}\n')}.css`)
    assert.equal(files.get('assets/js/a.js')!.bytes, 'const x=1;console.log(1);\n')
    assert.equal(files.get('assets/js/a.js')!.name, `assets/js/a.${hash('const x=1;console.log(1);\n')}.js`)
    assert.deepEqual(files.get('favicon.png'), { source: 'static/favicon.png', name: 'favicon.png' })
  })

  it('keep their names in a dev build, with TypeScript compiled as it is written', async () => {
    const files = await planTheme(dir, false)
    assert.deepEqual(
      [...files.values()].map((f) => f.name),
      ['assets/css/style.css', 'assets/js/a.js', 'favicon.png'],
    )
    const output = new Output(join(dir, 'out'))
    assert.equal(await writeTheme(dir, files, output, true), 3)
    assert.equal(readFileSync(join(dir, 'out', 'assets', 'js', 'a.js'), 'utf8'), 'const x = 1;\nconsole.log(x);\n')
    assert.equal(await writeTheme(dir, files, output, true), 0, 'a copy newer than its source stays')
  })

  it('are written under their final names', async () => {
    const files = await planTheme(dir, true)
    await writeTheme(dir, files, new Output(join(dir, 'out')), false)
    const name = files.get('assets/css/style.css')!.name
    assert.equal(readFileSync(join(dir, 'out', name), 'utf8'), 'body{color:red}\n')
  })

  it('give templates their URL paths as assets, and stop a template that asks for a file nobody writes', () => {
    const assets = assetsFor(new Map([['assets/css/style.css', 'assets/css/style.12345678.css']]))
    assert.equal(assets['/assets/css/style.css'], '/assets/css/style.12345678.css')
    assert.throws(() => assets['/assets/css/missing.css'], /assets has no file "\/assets\/css\/missing\.css"/)
  })
})
