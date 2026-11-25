import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import compileTemplates from '../compile-templates.ts'
import { init, namesOf, THEMES } from '../init.ts'
import loadSite from '../load-site.ts'
import { notesFor, pageContext } from '../page-context.ts'
import { renderContent } from '../render-content.ts'
import { siteView } from '../site-view.ts'
import { assetsFor, planTheme } from '../theme-files.ts'
import { quietly } from './helpers.ts'

const themes = await namesOf(THEMES)
let dir: string
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-optional-theme-content-'))
})
after(() => rm(dir, { recursive: true, force: true }))

describe('optional content in the bundled themes', () => {
  for (const theme of themes) {
    it(`${theme}: builds an empty home page without a page or site description`, async () => {
      const root = join(dir, `description-${theme}`)
      await init(root, ['en'], theme, 'blank')
      const configPath = join(root, 'config.lima')
      const config = await readFile(configPath, 'utf8')
      await writeFile(configPath, config.replace(/^ +description:.*\n/gm, ''))
      await writeFile(join(root, 'content/pages/[home]/home.md'), '---\ntitle: Home\nurlPath: /\ntemplate: home\n---\n')
      await quietly(() => build(root, 'publish'))
      const html = await readFile(join(root, '.hadley/publish/index.html'), 'utf8')
      assert.doesNotMatch(html, /(?:name="description"|property="og:description")/)
    })

    it(`${theme}: an archived article shows no series box in any build, and the other parts count without it`, async () => {
      const root = join(dir, `series-${theme}`)
      await init(root, ['en'], theme, 'blank')
      for (const [n, status] of [
        [1, 'published'],
        [2, 'archived'],
        [3, 'published'],
        [4, 'draft'],
      ] as const) {
        const bundle = join(root, `content/articles/@series/[part-${n}]`)
        await mkdir(bundle, { recursive: true })
        const frontMatter = `title: Part ${n}\npublishFrom: 2026-01-0${n}\nstatus: ${status}\n`
        await writeFile(join(bundle, `part-${n}.md`), `---\n${frontMatter}---\nText.\n`)
      }
      const boxes = async (mode: 'dev' | 'publish', n: number) => {
        const html = await readFile(join(root, `.hadley/${mode}/part-${n}/index.html`), 'utf8')
        return [...html.matchAll(/<summary>(Part \d+ of \d+)<\/summary>/g)].map((match) => match[1])
      }
      await quietly(() => build(root, 'publish'))
      assert.deepEqual(await boxes('publish', 1), ['Part 1 of 2'])
      assert.deepEqual(await boxes('publish', 2), [])
      assert.deepEqual(await boxes('publish', 3), ['Part 2 of 2'])
      // a dev build counts the draft, which will join the series
      await quietly(() => build(root, 'dev'))
      assert.deepEqual(await boxes('dev', 1), ['Part 1 of 3'])
      assert.deepEqual(await boxes('dev', 2), [])
      assert.deepEqual(await boxes('dev', 3), ['Part 2 of 3'])
      assert.deepEqual(await boxes('dev', 4), ['Part 3 of 3'])
    })

    it(`${theme}: an undated featured article and the feed page write no empty <time>`, async () => {
      const root = join(dir, `undated-${theme}`)
      await init(root, ['en'], theme, 'blank')
      const configPath = join(root, 'config.lima')
      await writeFile(configPath, (await readFile(configPath, 'utf8')) + 'featured_articles:\n  - id: undated\n')
      for (const [id, frontMatter] of [
        ['undated', 'title: Undated\n'],
        ['dated', 'title: Dated\npublishFrom: 2026-01-01\n'],
      ]) {
        const bundle = join(root, `content/articles/[${id}]`)
        await mkdir(bundle, { recursive: true })
        await writeFile(join(bundle, `${id}.md`), `---\n${frontMatter}---\nText.\n`)
      }
      await quietly(() => build(root, 'publish'))
      const home = await readFile(join(root, '.hadley/publish/index.html'), 'utf8')
      assert.match(home, /href="\/undated\/"/)
      assert.doesNotMatch(home, /datetime=""/)
      // the feed lists only dated articles (lib/feed.ts), so its page dates every entry
      const feed = await readFile(join(root, '.hadley/publish/feed/index.html'), 'utf8')
      assert.match(feed, /href="\/dated\/"/)
      assert.doesNotMatch(feed, /href="\/undated\/"|datetime=""/)
    })

    it(`${theme}: a list entry, article or note without the parts of its entry-meta writes none`, async () => {
      const root = join(dir, `bare-${theme}`)
      await init(root, ['en'], theme, 'blank')
      const configPath = join(root, 'config.lima')
      await writeFile(configPath, (await readFile(configPath, 'utf8')) + 'featured_articles:\n  - id: featured\n')
      for (const [type, id, source] of [
        ['articles', 'featured', '---\ntitle: Featured\n---\n'],
        ['articles', 'listed', '---\ntitle: Listed\n---\n'],
        // without a title, nothing counts for the reading time
        ['articles', 'untitled', ''],
        ['notes', 'noted', '---\ntitle: Noted\n---\n'],
      ]) {
        const bundle = join(root, `content/${type}/[${id}]`)
        await mkdir(bundle, { recursive: true })
        await writeFile(join(bundle, `${id}.md`), source)
      }
      // a dev build shows the article it would not publish without a title, and the note without publishFrom
      await quietly(() => build(root, 'dev'))
      const pages = ['index.html', 'untitled/index.html', 'notes/noted/index.html']
      const withEmptyMeta = []
      for (const page of pages) {
        const html = await readFile(join(root, '.hadley/dev', page), 'utf8')
        if (/<p class="entry-meta"[^>]*>\s*<\/p>/.test(html)) withEmptyMeta.push(page)
      }
      assert.deepEqual(withEmptyMeta, [])
    })

    it(`${theme}: an imprint writes only present data, with no empty sections or separators`, async () => {
      const root = join(dir, `imprint-${theme}`)
      await init(root, ['en'], theme, 'blank')
      const basedir = join(root, 'theme/templates')
      const templates = await compileTemplates({
        strictBraces: true,
        strictUndefined: true,
        includes: { basedir, import: (path, enc) => readFile(path, enc as BufferEncoding) },
      })
      const site = await loadSite(root, true)
      renderContent(site, true)
      const language = site.content.en!
      language.pages.imprint!.markup = ''
      const files = await planTheme(join(root, 'theme'), false)
      const context = pageContext(language.pages.imprint!, {
        site,
        view: siteView(language, 'en'),
        notes: notesFor(site, 'en', true),
        assets: assetsFor(new Map([...files].map(([path, file]) => [path, file.name]))),
        isPublish: true,
        og: false,
        coverMatrices: {},
        comments: undefined,
        feed: undefined,
      })
      const texts = site.locales.en!.imprint as Record<string, string>
      const fields = ['name', 'co', 'street', 'postalCode', 'locality', 'country', 'email', 'mobile']
      for (let mask = 0; mask < 2 ** fields.length; mask++) {
        const has = (field: string) => (mask & (1 << fields.indexOf(field))) !== 0
        const address = Object.fromEntries(
          fields
            .slice(1, 6)
            .filter(has)
            .map((field) => [field, field]),
        )
        const owner = {
          ...(has('name') ? { name: 'name' } : {}),
          ...(Object.keys(address).length ? { address } : {}),
          ...(has('email') ? { email: 'email', emailMailto: 'mailto:email@example.org' } : {}),
          ...(has('mobile') ? { mobile: 'mobile', mobileHref: 'tel:12345' } : {}),
          profiles: [],
        }
        const html = templates.imprint!.render({
          ...context,
          site: { ...(context.site as object), ownerLinks: owner },
        }) as string
        const prose = /<div class="prose">([\s\S]*?)<\/div>/.exec(html)![1]!
        const where = `${theme}, fields: ${fields.filter(has).join(', ')}`
        assert.equal(prose.includes(`<h2>${texts.address}</h2>`), Object.keys(address).length > 0, where)
        assert.equal(prose.includes(`<h2>${texts.contact}</h2>`), has('email') || has('mobile'), where)
        assert.equal(prose.includes(`<h2>${texts.responsible}</h2>`), has('name'), where)
        for (const match of prose.matchAll(/<(?:address|p)>([\s\S]*?)<\/(?:address|p)>/g)) {
          const content = match[1]!.replace(/>\s+</g, '><').trim()
          assert.ok(content.length > 0, where)
          assert.doesNotMatch(content, /^<br>|<br>$|<br><br>/, where)
        }
        if (mask === 0) assert.doesNotMatch(prose, /<address>|<br>|<h2>|<p>/)
      }
    })
  }
})
