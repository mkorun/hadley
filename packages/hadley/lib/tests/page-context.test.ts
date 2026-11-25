import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import { init, namesOf, THEMES } from '../init.ts'
import loadSite from '../load-site.ts'
import { copyrightYear, notesFor, pageContext, readingTimeMinutes } from '../page-context.ts'
import { renderContent } from '../render-content.ts'
import { siteView } from '../site-view.ts'
import type { Page } from '../site.ts'
import { quietly } from './helpers.ts'

const themes = await namesOf(THEMES)

// The language of a page is where its file lies in the bundle (page.language), not a front matter field.
const article = (language: string, charCount: number, mainArticle?: string) =>
  ({ language, result: { charCount }, mainArticle, metadata: { title: 'T' } }) as unknown as Page

describe('readingTimeMinutes', () => {
  it('reads an English article at 1100 characters a minute, a German one at 1000', () => {
    assert.equal(readingTimeMinutes(article('en', 1650)), 2)
    assert.equal(readingTimeMinutes(article('en', 1600)), 1)
    assert.equal(readingTimeMinutes(article('de', 1600)), 2)
  })

  it('reads a variant of another article at 700 a minute, whatever its language', () => {
    assert.equal(readingTimeMinutes(article('en', 1400, 'main')), 2)
  })

  it('gives no minutes to an article without text and at least one to any other', () => {
    assert.equal(readingTimeMinutes(article('de', 0)), 0)
    assert.equal(readingTimeMinutes(article('de', 10)), 1)
  })
})

describe('copyrightYear', () => {
  it('spans the years from site.since with an en dash, and gives one year when there is no span', () => {
    assert.equal(copyrightYear(2026, 2028), '2026–2028')
    assert.equal(copyrightYear(2026, 2026), '2026')
    assert.equal(copyrightYear(undefined, 2027), '2027')
  })
})

describe('the context of pages outside discovery', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hadley-unlisted-context-'))
  })
  after(() => rm(dir, { recursive: true, force: true }))

  for (const theme of themes)
    it(`${theme}: builds an archived article with strictUndefined`, async () => {
      const root = join(dir, theme)
      await init(root, ['en'], theme, 'blank')
      const bundle = join(root, 'content/articles/[old]')
      await mkdir(bundle, { recursive: true })
      await writeFile(join(bundle, 'old.md'), '---\nstatus: archived\n---\n# Old\n\nEarlier writing.\n')
      await quietly(() => build(root, 'publish'))
      const html = await readFile(join(root, '.hadley/publish/old/index.html'), 'utf8')
      assert.match(html, /name="robots" content="noindex"/)
      assert.doesNotMatch(html, /hreflang=/)
    })

  it('keeps collections defined for archived, draft and sitemap-excluded pages', async () => {
    const root = join(dir, 'audit')
    await init(root, ['en'], 'hems', 'blank')
    const bundle = join(root, 'content/articles/[piece]')
    await mkdir(bundle, { recursive: true })
    for (const [front, publish, translations] of [
      ['status: archived', true, {}],
      ['status: draft', false, { en: '/piece/' }],
      ['sitemap: false', true, { en: '/piece/' }],
    ] as const) {
      await writeFile(join(bundle, 'piece.md'), `---\n${front}\n---\n# Piece\n\nText.\n`)
      const site = await loadSite(root, publish)
      renderContent(site, publish)
      const language = site.content.en!
      const context = pageContext(language.pages.piece!, {
        site,
        view: siteView(language, 'en'),
        notes: notesFor(site, 'en', publish),
        assets: {},
        isPublish: publish,
        og: false,
        coverMatrices: {},
        comments: undefined,
        feed: undefined,
      })
      assert.deepEqual(context.translations, translations, front)
      assert.equal(context.hasTranslations, false)
      assert.deepEqual(
        Object.entries(context)
          .filter(([, value]) => value === undefined)
          .map(([key]) => key)
          .sort(),
        ['categoryLabel', 'feed', 'ogImage'],
        'only the documented optional scalar/feature values are undefined',
      )
      assert.ok(Object.values(context.html as Record<string, unknown>).every((value) => value !== undefined))
    }
  })
})
