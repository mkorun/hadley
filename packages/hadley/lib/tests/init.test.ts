import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import {
  BLANK,
  STARTERS,
  THEMES,
  init,
  namesOf,
  pageFor,
  parseLanguages,
  starterBlocks,
  starterLanguages,
  starterOf,
  targetOf,
  withoutLanguages,
} from '../init.ts'
import { slashed } from '../platform.ts'

// hadley init (docs/init.md): a starter with a theme, in the languages named.

const starters = await namesOf(STARTERS)
const themes = await namesOf(THEMES)
const written = Object.fromEntries(
  await Promise.all(starters.map(async (starter) => [starter, await starterLanguages(starter)] as const)),
)

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-init-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the languages of hadley init', () => {
  it('are English alone without --language, all with all, and those named, the default first', () => {
    const five = ['en', 'de', 'fr', 'es', 'it']
    assert.deepEqual(written.hems, five)
    assert.deepEqual(parseLanguages(undefined, five), ['en'])
    assert.deepEqual(parseLanguages('all', five), five)
    assert.deepEqual(parseLanguages('de, en', five), ['de', 'en'])
    assert.throws(() => parseLanguages('de,nl', five), /written in en, de, fr, es, it, not "nl"/)
    assert.throws(() => parseLanguages('de,de', five), /de is named twice/)
  })

  it("are the language blocks of each starter's config.lima, as its bundles' language folders are", async () => {
    for (const starter of starters) {
      const folders = new Set<string>()
      for (const path of await readdir(join(STARTERS, starter, 'content'), { recursive: true })) {
        const segments = slashed(path).split('/')
        const bundle = segments.findLastIndex((segment) => /^\[.+\]$/.test(segment))
        if (bundle !== -1 && segments.length === bundle + 3) folders.add(segments[bundle + 1]!)
      }
      const others = written[starter]!.filter((language) => language !== 'en')
      assert.deepEqual([...folders].sort(), others.sort(), starter)
    }
  })
})

describe('what hadley init writes', () => {
  it('leaves out the blocks and keys of the languages not named, and keeps the blank line after one', () => {
    const lima = 'site:\n  en:\n    claim: A\n  fr:\n    claim: B\n\n# next\nlabel:\n  en: Essay\n  fr: Essai\n'
    assert.equal(withoutLanguages(lima, ['fr']), 'site:\n  en:\n    claim: A\n\n# next\nlabel:\n  en: Essay\n')
  })

  it("takes the blocks of the theme's starter: as top-level Lima", () => {
    const theme =
      'settings:\n  a:\n    defaultValue: 1\n\nstarter:\n  theme:\n    a: 2\n  highlighting:\n    theme: nord\n'
    assert.equal(starterBlocks(theme), 'theme:\n  a: 2\nhighlighting:\n  theme: nord')
    assert.equal(starterBlocks('settings:\n'), '')
  })

  it('moves the prefix of a urlPath with the default language', () => {
    assert.equal(pageFor('---\nurlPath: /de/\n---\n', 'de', 'de'), '---\nurlPath: /\n---\n')
    assert.equal(pageFor('---\nurlPath: /404/\n---\n', 'en', 'de'), '---\nurlPath: /en/404/\n---\n')
    assert.equal(pageFor('---\nurlPath: /fr/\n---\n', 'fr', 'de'), '---\nurlPath: /fr/\n---\n')
  })

  it('puts the pages of the default language into the bundle, English into en/, and leaves images where they are', () => {
    const languages = ['de', 'en']
    assert.deepEqual(targetOf(['pages', '[a]', 'de', 'a.md'], languages, 'de'), {
      segments: ['pages', '[a]', 'a.md'],
      page: 'de',
    })
    assert.deepEqual(targetOf(['pages', '[a]', 'a.md'], languages, 'de'), {
      segments: ['pages', '[a]', 'en', 'a.md'],
      page: 'en',
    })
    assert.deepEqual(targetOf(['pages', '[a]', 'a.png'], languages, 'de'), { segments: ['pages', '[a]', 'a.png'] })
    assert.equal(targetOf(['pages', '[a]', 'fr', 'a.md'], languages, 'de'), null)
  })

  it("refuses a directory that is not empty, a theme hadley does not bring, and another theme's starter", async () => {
    await writeFile(join(dir, 'taken'), '')
    await assert.rejects(init(dir, ['en'], 'hems', 'hems'), /is not empty/)
    await assert.rejects(init(join(dir, 'new'), ['en'], 'nowhere', 'hems'), /hadley brings hems, punch/)
    await assert.rejects(init(join(dir, 'new'), ['en'], 'hems', 'punch'), /the starter punch is not the theme hems's/)
    await assert.rejects(starterOf('nowhere', true), /hadley brings hems, punch/)
  })

  it('gives a theme its own starter, or the blank one', async () => {
    assert.equal(await starterOf('punch', false), 'punch')
    assert.equal(await starterOf('punch', true), 'blank')
    assert.deepEqual(starters, [BLANK, ...themes])
  })
})

// review 2026-10-28 (C.4): every starter in every language as the default, with others, builds for publishing with
// each theme it goes with: its own, and the blank starter with every theme
describe('a site hadley init makes', () => {
  for (const starter of starters) {
    const all = written[starter]!
    const cases = [...all.map((language) => [language]), ...(all.length > 1 ? [all.slice(0, 2).reverse(), all] : [])]
    for (const languages of cases)
      it(`builds from ${starter} in ${languages.join(', ')}`, async () => {
        for (const theme of starter === BLANK ? themes : [starter]) {
          const site = join(dir, `${starter}-${theme}-${languages.join('-')}`)
          await init(site, languages, theme, starter)
          const write = process.stdout.write.bind(process.stdout)
          process.stdout.write = () => true
          try {
            await build(site, 'publish')
          } finally {
            process.stdout.write = write
          }
          const home = await readFile(join(site, '.hadley', 'publish', 'index.html'), 'utf-8')
          assert.ok(home.includes(`<html lang="${languages[0]}"`), `the home page is in ${languages[0]}`)
          const pages = await readdir(join(site, '.hadley', 'publish'))
          for (const other of languages.slice(1)) assert.ok(pages.includes(other), `${other}/ is published`)
        }
      })
  }
})

// review 2026-10-28 (C.5): a page whose template the theme lacks stopped the build over its cover's image config
describe('a page of a site', () => {
  it('stops the build when the theme has no template it names', async () => {
    const site = join(dir, 'no-template')
    await init(site, ['en'], 'hems', 'hems')
    const page = join(site, 'content', 'pages', '[about]', 'about.md')
    await writeFile(page, (await readFile(page, 'utf-8')).replace('title: About', 'title: About\ntemplate: nope'))
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await assert.rejects(
        build(site, 'publish'),
        /about\.md: the theme has no template nope \(templates\/nope\.chase\)/,
      )
    } finally {
      process.stdout.write = write
    }
  })
})
