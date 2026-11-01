import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import loadSite, { localDay } from '../load-site.ts'
import { settle } from '../problems.ts'

// What load-site decides once for every page (lib/site.ts): the fields of the front matter hadley reads, the state,
// and the languages of the site.

let dir: string
const cwd = process.cwd()

/** A site `name` with the pages `content` (paths in content/) and the default language `language`. */
async function site(name: string, content: Record<string, string>, language = 'de') {
  const root = join(dir, 'sites', name)
  for (const [file, text] of Object.entries(content)) {
    await mkdir(join(root, 'content', file, '..'), { recursive: true })
    await writeFile(join(root, 'content', file), text)
  }
  await writeFile(
    join(root, 'config.lima'),
    `site:\n  origin: https://test.example\n  default:\n    language: ${language}\n    title: Test\n`,
  )
}

/** Loads `name` for publishing, deciding its pages' problems as the build does. */
const published = async (name: string) => {
  const loaded = await loadSite(join('sites', name), true)
  settle(loaded.problems, true)
  return loaded
}

const page = (frontMatter: string) => `---\n${frontMatter}---\nText.\n`
const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const log = console.log
  console.log = () => {}
  try {
    return await run()
  } finally {
    console.log = log
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-load-site-test-'))
  process.chdir(dir)
})

after(async () => {
  process.chdir(cwd)
  await rm(dir, { recursive: true, force: true })
})

describe('the front matter of a page', () => {
  it('gives each field hadley reads one kind: dates, a list of tags, the pixel as a text; an empty field is left out', async () => {
    await site('kinds', {
      'articles/[a]/a.md': page(
        `title: A\npublishFrom: 2026-01-02\nupdatedAt: "2026-02-03"\ntags: eins\nvgwort_pixel: 1234\nsubtitle:\n`,
      ),
    })
    const { metadata } = (await loadSite(join('sites', 'kinds'), true)).content.de!.pages.a!
    assert.ok(metadata.publishFrom instanceof Date)
    assert.equal(metadata.updatedAt?.toISOString(), '2026-02-03T00:00:00.000Z')
    assert.deepEqual(metadata.tags, ['eins'])
    assert.equal(metadata.vgwort_pixel, '1234')
    assert.ok(!('subtitle' in metadata))
  })

  it('fails publishing a page with a field of another kind, named; the dev build warns', async () => {
    const wrong = 'title:\n  - A\n  - B\nsubtitle: 1984\npublishFrom: soon\ntags:\n  - x:\n      y: 1\nnoindex: 1\n'
    await site('wrong', { 'articles/[a]/a.md': page(wrong) })
    await assert.rejects(
      published('wrong'),
      (error: Error) =>
        [
          'title is not a text',
          'publishFrom is not a date',
          'tags is not a text or a list',
          'subtitle is not a text (in quotes',
        ].every((part) => error.message.includes(`front matter field ${part}`)) &&
        error.message.includes('a.md: has no title'),
    )
    const dev = await quietly(() => loadSite(join('sites', 'wrong'), false))
    assert.equal(dev.content.de!.pages.a!.metadata.title, '')
    const warnings = settle(dev.problems, false)
    assert.ok(warnings.some((warning) => warning.includes('front matter field publishFrom is not a date')))
  })

  it('reads a date in quotes only in ISO form, as no host then reads another day', async () => {
    const date = async (name: string, value: string) => {
      await site(name, { 'articles/[a]/a.md': page(`publishFrom: ${value}\ntitle: A\n`) })
      const dev = await quietly(() => loadSite(join('sites', name), false))
      return { warnings: settle(dev.problems, false), date: dev.content.de!.pages.a!.metadata.publishFrom }
    }
    for (const [name, value] of Object.entries({
      german: '"01.03.2030"',
      local: '"2030-01-01 10:00"',
      noDay: '"2026-02-30"',
    })) {
      const { warnings } = await date(`date-${name}`, value)
      assert.ok(
        warnings.some((warning) => warning.includes('publishFrom is not a date')),
        value,
      )
    }
    assert.equal((await date('date-iso', '"2030-01-01"')).date?.toISOString(), '2030-01-01T00:00:00.000Z')
    // Lima trims a no-break space after a value, so this is the day a reader sees
    assert.equal((await date('date-space', '2030-01-01\u00a0')).date?.toISOString(), '2030-01-01T00:00:00.000Z')
    assert.equal(
      (await date('date-time', '"2030-01-01T10:00:00+02:00"')).date?.toISOString(),
      '2030-01-01T08:00:00.000Z',
    )
  })

  it('fails a page that nests deeper than any text, without taking the memory of the build', async () => {
    const deep = Array.from({ length: 200 }, (_, depth) => `${'  '.repeat(depth)}- x`).join('\n')
    await site('deep', { 'articles/[a]/a.md': `${page('title: A\n')}\n${deep}\n` })
    await assert.rejects(published('deep'), (error: Error) => error.message.includes('a.md'))
  })

  it('stops at a status it does not know, in both builds', async () => {
    await site('status', { 'articles/[a]/a.md': page('title: A\nstatus: publshed\n') })
    await assert.rejects(
      loadSite(join('sites', 'status'), true),
      /a\.md: status publshed is not one of draft, seed, published/,
    )
    await assert.rejects(loadSite(join('sites', 'status'), false), /status publshed/)
  })

  // review 2026-10-26: the fields that place a page skipped the field check: template: 42 stopped a dev build as a
  // missing template, sitemap: "false" put the page into the sitemap
  it('stops every build at a field that places the page and is no text, and checks sitemap like any field', async () => {
    for (const field of ['template', 'type', 'urlPath', 'status']) {
      const draft = field === 'status' ? '' : 'status: draft\n'
      await site(`place-${field}`, { 'articles/[a]/a.md': page(`title: A\n${draft}${field}: 42\n`) })
      for (const publish of [true, false]) {
        await assert.rejects(
          quietly(() => loadSite(join('sites', `place-${field}`), publish)),
          (error: Error) => error.message.endsWith(`a.md: the front matter field ${field} is not a text`),
        )
      }
    }
    await site('sitemap', { 'articles/[a]/a.md': page('title: A\nsitemap: "false"\n') })
    await assert.rejects(published('sitemap'), /a\.md:3: the front matter field sitemap is not true or false/)
  })
})

describe('what the site holds besides its pages', () => {
  // review 2026-10-24 (Fable): a locale file Lima rejected became {}, so every t.* rendered empty
  it('stops at a theme text file Lima rejects, or one missing for a language of the site', async () => {
    await site('texts', { 'articles/[a]/a.md': page('title: A\n'), 'articles/[a]/en/a.md': page('title: A\n') })
    await mkdir(join(dir, 'sites', 'texts', 'theme', 'i18n'), { recursive: true })
    await writeFile(join(dir, 'sites', 'texts', 'theme', 'i18n', 'de.lima'), 'nav:\n  back: Zurück\n')
    await assert.rejects(
      loadSite(join('sites', 'texts'), true),
      /i18n\/en\.lima is missing: the theme has texts, and the site has/,
    )
    await writeFile(join(dir, 'sites', 'texts', 'theme', 'i18n', 'en.lima'), `nav:\n  back: ${'x'.repeat(16385)}\n`)
    await assert.rejects(loadSite(join('sites', 'texts'), true), /i18n\/en\.lima:2: /)
    await writeFile(join(dir, 'sites', 'texts', 'theme', 'i18n', 'en.lima'), 'nav:\n  skip: Skip\n')
    const { locales } = await loadSite(join('sites', 'texts'), true)
    assert.deepEqual(locales.en, { nav: { back: 'Zurück', skip: 'Skip' } })
  })

  it('stops at a file of content/meta Lima rejects, instead of leaving it out', async () => {
    await site('meta', { 'articles/[a]/a.md': page('title: A\n') })
    await mkdir(join(dir, 'sites', 'meta', 'content', 'meta', 'persons'), { recursive: true })
    await writeFile(join(dir, 'sites', 'meta', 'content', 'meta', 'persons', 'x.lima'), `name: ${'x'.repeat(16385)}\n`)
    await assert.rejects(loadSite(join('sites', 'meta'), true), /content[\\/]meta[\\/]persons[\\/]x\.lima:1: /)
  })

  // review 2026-10-24 (Fable): a required field missing was logged, and the page published
  it('fails publishing a page without a field config.lima requires', async () => {
    await site('required', { 'articles/[a]/a.md': page('title: A\n') })
    const config = join(dir, 'sites', 'required', 'config.lima')
    await writeFile(config, `${await readFile(config, 'utf8')}metadata:\n  author:\n    required: true\n`)
    await assert.rejects(published('required'), /a\.md: the front matter field author is required/)
  })

  // review 2026-10-25: any field went into meta, so `lang: fr` outvoted the language of the page's folder
  it('fails publishing a page with a field neither hadley nor config.lima knows, or one hadley sets itself', async () => {
    // Michael 2026-10-26: hadley does not support a text written by AI alone; ai_generated is no field of hadley's
    const fields = 'title: A\nai_assisted: true\nai_generated: true\nmood: heiter\nhinweis: ja\nlang: fr\nid: x\n'
    await site('fields', { 'articles/[a]/a.md': page(fields) })
    const config = join(dir, 'sites', 'fields', 'config.lima')
    await writeFile(config, `${await readFile(config, 'utf8')}metadata:\n  hinweis:\n`)
    await assert.rejects(published('fields'), (error: Error) => {
      const lines = error.message.split('\n').slice(1)
      // each with the line of its field (lib/lines.ts)
      const field = (line: number) => `a.md:${line}: the front matter field`
      assert.equal(lines.length, 4)
      assert.ok(lines[0]!.endsWith(`${field(4)} ai_generated is neither one hadley reads nor one config.lima declares`))
      lines.shift()
      assert.ok(lines[0]!.endsWith(`${field(5)} mood is neither one hadley reads nor one config.lima declares`))
      assert.ok(
        lines[1]!.endsWith(
          `${field(7)} lang is one hadley sets itself: a page is in the language of the folder its file is in`,
        ),
      )
      assert.ok(lines[2]!.endsWith(`${field(8)} id is one hadley sets itself`))
      return true
    })
    const dev = await quietly(() => loadSite(join('sites', 'fields'), false))
    const metadata = dev.content.de!.pages.a!.metadata
    assert.deepEqual(
      [metadata.ai_assisted, metadata.hinweis, 'mood' in metadata, 'lang' in metadata],
      [true, 'ja', false, false],
    )
    await writeFile(config, `${await readFile(config, 'utf8')}  lang:\n`)
    await assert.rejects(
      loadSite(join('sites', 'fields'), true),
      /config\.lima: metadata\.lang is a field hadley sets itself/,
    )
  })
})

describe('the languages of a site', () => {
  // review 2026-10-24 (Fable): the feed, llms.txt and sitelinks.json took the language of the first bundle read
  it('are the configured default first and the others by name, whatever the bundles hold', async () => {
    await site('languages', {
      'articles/[a]/fr/a.md': page('title: A\npublishFrom: 2026-01-01\n'),
      'articles/[a]/en/a.md': page('title: A\npublishFrom: 2026-01-01\n'),
      'articles/[b]/b.md': page('title: B\npublishFrom: 2026-01-01\n'),
    })
    const loaded = await loadSite(join('sites', 'languages'), true)
    assert.equal(loaded.defaultLanguage, 'de')
    assert.deepEqual(Object.keys(loaded.content), ['de', 'en', 'fr'])
    await site('no-default-pages', { 'articles/[a]/en/a.md': page('title: A\npublishFrom: 2026-01-01\n') }, 'de')
    assert.deepEqual(Object.keys((await loadSite(join('sites', 'no-default-pages'), true)).content), ['de', 'en'])
  })

  it('each have the home page a publish build lists, if they have one, and no more than one', async () => {
    const home = (urlPath: string, more = '') => page(`title: Home\nurlPath: ${urlPath}\ntemplate: home\n${more}`)
    await site('homes', {
      'pages/[home]/home.md': home('/'),
      'pages/[home]/en/home.md': home('/en/'),
      'pages/[home]/fr/home.md': home('/fr/', 'status: draft\n'),
    })
    const loaded = await published('homes')
    assert.equal(loaded.content.de!.home, '/')
    assert.equal(loaded.content.en!.home, '/en/')
    assert.equal(loaded.content.fr!.home, undefined)
    await site('two-homes', { 'pages/[home]/home.md': home('/'), 'pages/[start]/start.md': home('/start/') })
    await assert.rejects(published('two-homes'), /language "de" has two home pages, \/ and \/start\/|\/start\/ and \//)
  })
})

describe('a publish build', () => {
  it('has only the pages it writes; links still know the others as unpublished', async () => {
    await site('publish', {
      'articles/[a]/a.md': page('title: A\npublishFrom: 2026-01-01\n'),
      'articles/[b]/b.md': page('title: B\nstatus: draft\n'),
      'articles/[c]/c.md': page('title: C\npublishFrom: 2999-01-01\n'),
      'articles/[d]/d.md': page('title: D\nstatus: archived\npublishFrom: 2026-01-01\n'),
    })
    const loaded = await loadSite(join('sites', 'publish'), true)
    assert.deepEqual(Object.keys(loaded.content.de!.pages).sort(), ['a', 'd'])
    assert.equal(loaded.skipped, 2)
    assert.deepEqual([...loaded.unpublishedIds.de!].sort(), ['b', 'c', 'd'])
    assert.equal(loaded.content.de!.pages.d!.state, 'archived')
  })
})

// review 2026-10-26 (perf): splitting load-site took a variant's empty name (`_.md`) for none
describe('the variants of a page', () => {
  it('are named after the file, even an empty name', async () => {
    await site('empty-variant', {
      'articles/[a]/a.md': page('title: A\npublishFrom: 2026-01-01\n'),
      'articles/[a]/_.md': page('title: Leer\nurlPath: /a-leer/\n'),
    })
    const loaded = await published('empty-variant')
    assert.deepEqual(Object.keys(loaded.content.de!.pages).sort(), ['a', 'a_'])
    assert.equal(loaded.content.de!.pages['a_']!.mainArticle, 'a')
  })
})

// the day was the day in UTC: a page scheduled for the 27th appeared at 1 a.m. in Berlin in winter
describe('the day a build decides scheduling on', () => {
  // review 2026-10-26 (dev server): the test passed with the UTC day in a UTC environment
  it('is the day where the build runs, whatever zone that is', () => {
    const zone = process.env.TZ
    try {
      // 23:30 UTC on the 26th: the 27th in Berlin, still the 26th in New York
      const late = new Date('2026-10-26T23:30:00Z')
      process.env.TZ = 'Europe/Berlin'
      assert.equal(localDay(late), '2026-10-27')
      process.env.TZ = 'America/New_York'
      assert.equal(localDay(late), '2026-10-26')
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
  })
})
