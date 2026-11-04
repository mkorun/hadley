import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { build } from '../../index.ts'
import loadSite from '../load-site.ts'
import { categoryLabel, notesFor } from '../page-context.ts'
import { settle } from '../problems.ts'
import { linksJson } from '../site-data.ts'
import { renderContent } from '../render-content.ts'

let dir: string
const page = (front: string, text = 'Text.\n') => `---\n${front}---\n${text}`
const note = (front = '', text = '# News\n\nA **short** piece.\n') => page(`publishFrom: 2020-03-28\n${front}`, text)
const put = async (path: string, text: string) => {
  const file = join(dir, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}
const load = (publish = false) => loadSite(dir, publish)
const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    return await run()
  } finally {
    process.stdout.write = write
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-notes-test-'))
  await put(
    'config.lima',
    'site:\n  origin: https://notes.example\n  default:\n    language: en\n    title: Notes\n' +
      '  en:\n    locale: en_GB\n  de:\n    locale: de_DE\nmetadata:\n  detail:\nrss:\n  enabled: true\n' +
      'markdown:\n  enabled: true\n',
  )
  await put('theme/i18n/en.lima', 'categories:\n  issue: Issue\nlabel: News\n')
  await put('theme/i18n/de.lima', 'categories:\n  issue: Problem\nlabel: Neues\n')
  await put('content/pages/[home]/home.md', page('title: Home\ntemplate: home\nurlPath: /\n'))
  await put('content/pages/[home]/de/start.md', page('title: Start\ntemplate: home\nurlPath: /de/\n'))
  await put('content/pages/[about]/about.md', page('title: About\n'))
  await put(
    'theme/templates/page.chase',
    '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>{@raw html.markup}</body></html>',
  )
  await put('theme/templates/note.chase', await readFile(join(dir, 'theme/templates/page.chase'), 'utf8'))
  await put('theme/templates/essay.chase', await readFile(join(dir, 'theme/templates/page.chase'), 'utf8'))
  await put('theme/templates/article.chase', await readFile(join(dir, 'theme/templates/page.chase'), 'utf8'))
  await put('theme/templates/home.chase', await readFile(join(dir, 'theme/templates/page.chase'), 'utf8'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a note’s front matter', () => {
  for (const [name, source, field] of [
    ['missing date', page('', '# News\n'), /publishFrom/],
    ['invalid date', page('publishFrom: tomorrow\n', '# News\n'), /publishFrom is not a date/],
    ['missing title', page('publishFrom: 2020-01-01\n'), /title/],
    ['empty title with a heading', note("title: ''\n"), /title/],
    ['empty title', note("title: ''\n", 'Text.\n'), /title/],
    ['blank title with invalid subtitle', note("title: '  '\nsubtitle: [bad]\n", 'Text.\n'), /title must not be empty/],
    ['late title', note('', 'Intro.\n\n# Too late\n'), /title/],
    ['duplicate title', note('title: Twice\n'), /title is given twice/],
    ['http link', note('link: http://example.org\n'), /link must be an https URL/],
    ['relative link', note('link: /elsewhere/\n'), /link must be an https URL/],
    ['scheme link', note('link: javascript:alert(1)\n'), /link must be an https URL/],
    ['malformed link', note('link: https://[bad]\n'), /link must be an https URL/],
    ['no host', note('link: https:example.org\n'), /link must be an https URL/],
    ['non-text link', note('link: true\n'), /link is not a text/],
    ['invalid title', note('title: [one, two]\n', 'Text.\n'), /title is not a text/],
    ['invalid tags', note('tags: [one, 2]\n'), /tags is not a text or a list/],
  ] as const) {
    it(`reports ${name} as a problem of the note and refuses publishing`, async () => {
      await put('content/notes/news.md', source)
      const site = await load(true)
      const warnings = settle(site.problems, false)
      assert.ok(
        warnings.some((warning) => warning.includes('news.md') && field.test(warning)),
        warnings.join('\n'),
      )
      assert.throws(() => settle(site.problems, true), field)
    })
  }

  it('uses the page title and subtitle extraction, or a front-matter title', async () => {
    await put('content/notes/news.md', note('link: https://example.org/news\n', '# News\n__Subtitle__\n\nBody.\n'))
    await put('content/notes/front.md', note('title: Front\n', 'Other body.\n'))
    const site = await load(true)
    assert.deepEqual(settle(site.problems, true), [])
    renderContent(site, true)
    const notes = site.content.en!.pages
    assert.equal(notes.news!.metadata.title, 'News')
    assert.equal(notes.news!.metadata.subtitle, 'Subtitle')
    assert.equal(notes.news!.markup, '<p>Body.</p>')
    assert.equal(notes.front!.markup, '<p>Other body.</p>')
    assert.equal(
      notesFor(site, 'en', true).find((entry) => entry.urlPath === '/notes/news/')?.link,
      'https://example.org/news',
    )
  })

  it('stops the actual publish build at a missing publishFrom', async () => {
    await put('content/notes/news.md', page('', '# News\n'))
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /news\.md: the note requires publishFrom/,
    )
  })
})

describe('noteList', () => {
  it('orders solitary, bundled and collection notes by date, then id by UTF-16 code unit, separately for each language', async () => {
    await put('content/notes/z.md', note('updatedAt: 2020-05-01\n'))
    await put('content/notes/[a]/a.md', note('category: issue\ntags: [tools, go]\ndetail: Extra\n'))
    await put('content/notes/[a]/de/nachricht.md', note('category: issue\n', '# Nachricht\n\nText.\n'))
    await put('content/notes/@2026/[A]/news.md', note())
    await put('content/notes/latest.md', page('publishFrom: 2020-03-29\ntitle: Latest\n'))
    const site = await load(true)
    site.today = '2020-03-30'
    assert.deepEqual(settle(site.problems, true), [])
    const en = notesFor(site, 'en', true)
    assert.deepEqual(
      en.map((entry) => entry.urlPath),
      ['/notes/latest/', '/notes/news/', '/notes/a/', '/notes/z/'],
    )
    assert.deepEqual(
      notesFor(site, 'de', true).map((entry) => entry.urlPath),
      ['/de/notes/nachricht/'],
    )
    const a = en.find((entry) => entry.urlPath === '/notes/a/')!
    assert.deepEqual(a, {
      urlPath: '/notes/a/',
      title: 'News',
      subtitle: '',
      description: '',
      publishFrom: new Date('2020-03-28'),
      updatedAt: '',
      displayDate: new Date('2020-03-28'),
      isUpdated: false,
      status: 'published',
      showBadge: false,
      link: '',
      category: 'issue',
      categoryLabel: 'Issue',
      cover: null,
      isAiCover: false,
      tags: ['tools', 'go'],
      ageDays: 2,
      isDraft: false,
    })
    assert.equal(notesFor(site, 'de', true)[0]!.categoryLabel, 'Problem')
  })

  it('lists only published notes when publishing, and all states in dev with drafts and seeds marked', async () => {
    for (const state of ['published', 'draft', 'seed', 'archived'])
      await put(`content/notes/${state}.md`, note(`status: ${state}\n`))
    await put('content/notes/future.md', page('publishFrom: 9999-01-01\ntitle: Future\n'))
    const site = await load(false)
    assert.deepEqual(
      notesFor(site, 'en', true).map((entry) => entry.urlPath),
      ['/notes/published/'],
    )
    const dev = notesFor(site, 'en', false)
    assert.deepEqual(
      dev.map(({ urlPath, isDraft }) => [urlPath, isDraft]),
      [
        ['/notes/future/', false],
        ['/notes/archived/', false],
        ['/notes/draft/', true],
        ['/notes/published/', false],
        ['/notes/seed/', true],
      ],
    )
    assert.ok(dev[0]!.ageDays < 0)
    assert.deepEqual(
      notesFor(await load(true), 'en', true).map((entry) => entry.urlPath),
      ['/notes/published/'],
    )
  })

  it('counts calendar days using the scheduling day, ignoring time of day and daylight saving', async () => {
    await put('content/notes/news.md', page('publishFrom: "2020-03-28T23:30:00Z"\ntitle: News\n'))
    const site = await load()
    site.today = '2020-03-30'
    assert.equal(notesFor(site, 'en', false)[0]!.ageDays, 2)
    site.today = '2020-03-28'
    assert.equal(notesFor(site, 'en', false)[0]!.ageDays, 0)
  })
})

const output = (file: string, mode = 'publish') => readFile(join(dir, '.hadley', mode, file), 'utf8')
const imageConfig =
  '<galley:config>{"images":{' +
  '"default":{"widths":[4],"formats":["webp"],"sizes":"100vw","quality":80},' +
  '"cover":{"widths":[4],"formats":["webp"],"sizes":"100vw","quality":80}}}</galley:config>'
const png = (path: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toFile(join(dir, path))

describe('notes as pages', () => {
  it('requires the root’s note template, just as any page requires its template', async () => {
    await put('content/notes/news.md', note())
    await rm(join(dir, 'theme/templates/note.chase'))
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /theme has no template note \(templates\/note.chase\)/,
    )
  })

  it('checks raw values in the note layout and its partials', async () => {
    await put('content/notes/news.md', note())
    await put('theme/templates/note.chase', '{@partial partials/note.sort}')
    await put('theme/templates/partials/note.sort', '{@raw meta.title}')
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /note.sort: .*writes a value as HTML/,
    )
  })

  it('builds a note with its own head, files, cover, Markdown twin and discovery entries', async () => {
    await put(
      'content/notes/[news]/news.md',
      note(
        'description: A short description.\ncover: pic.png\nog:image: pic.png\nlink: https://example.org/issue\n',
        '# News\n\n[Paper](paper.pdf)\n\n![Alt](pic.png)\n',
      ),
    )
    await put('content/notes/[news]/paper.pdf', 'A test document')
    await png('content/notes/[news]/pic.png')
    await put('content/pages/[about]/about.md', page('title: About\n', '[News]($news)\n'))
    const template =
      imageConfig +
      '<!doctype html><html><head><title>{ htmlTitle }</title>' +
      '<link rel="canonical" href="{ canonicalUrl }"><meta property="og:image" content="{ ogImage }">' +
      '</head><body><p>{ type }|{ template }|{ urlPath }</p>{@raw html.cover}{@raw html.markup}</body></html>'
    await put('theme/templates/note.chase', template)
    const result = await quietly(() => build(dir, 'publish'))
    const html = await output('notes/news/index.html')
    assert.match(html, /<title>News<\/title>/)
    assert.match(html, /href="https:\/\/notes.example\/notes\/news\/"/)
    assert.match(html, /content="https:\/\/notes.example\/notes\/news\/pic.png"/)
    assert.match(html, /note\|note\|\/notes\/news\//)
    assert.match(html, /href="paper.pdf"/)
    assert.match(html, /src="pic-4w.webp"/)
    assert.match(html, /srcset="pic-4w.webp 4w"/)
    assert.equal(await output('notes/news/paper.pdf'), 'A test document')
    assert.match(
      await output('notes/news/index.html.md'),
      /\[Paper\]\(https:\/\/notes.example\/notes\/news\/paper.pdf\)/,
    )
    assert.match(await output('about/index.html'), /href="\/notes\/news\/"/)
    assert.match(await output('sitemap.xml'), /https:\/\/notes.example\/notes\/news\//)
    assert.match(await output('llms.txt'), /https:\/\/notes.example\/notes\/news\/index.html.md/)
    assert.doesNotMatch(await output('feed.xml'), /\/notes\/news\//)
    assert.ok(result.searchable.includes('notes/news/index.html'))
  })

  it('gives every template the same escaped noteList, including list covers, and excludes notes from article lists', async () => {
    await put(
      'content/notes/[news]/news.md',
      note(
        "title: '<script>title</script>'\ntags: ['<script>tag</script>']\ncover: pic.png\n" +
          'link: https://example.org/issue\ncategory: issue\nupdatedAt: 2020-03-29\n',
        'Body.\n',
      ),
    )
    await png('content/notes/[news]/pic.png')
    await put('content/articles/[article]/article.md', page('title: Article\npublishFrom: 2020-03-28\n'))
    const config = await readFile(join(dir, 'config.lima'), 'utf8')
    await put('config.lima', config + 'featured_articles:\n  - id: news\nfeatured_series:\n  - id: mixed\n')
    await put('content/notes/@mixed/other.md', note())
    const template =
      imageConfig +
      '<!doctype html><title>{ meta.title }</title><body>' +
      '<ul>{#each noteList as n}<li><a href="{ n.link }">{ n.title }</a>{ n.tags[0] }' +
      '{ n.categoryLabel }|{ n.status }|{ n.isUpdated }{#if n.cover}<img src="{ n.cover.src }" alt="">{/if}</li>{/each}</ul>' +
      '<p class="articles">{#each articleList as a}{ a.title }{/each}</p>' +
      '<p class="featured">{#each featuredList as a}{ a.title }{/each}</p>' +
      '<p class="neighbours">{ newer.title }|{ older.title }</p></body>'
    for (const name of ['home', 'page', 'article', 'note']) await put(`theme/templates/${name}.chase`, template)
    await quietly(() => build(dir, 'publish'))
    const news = await output('notes/news/index.html')
    for (const file of ['index.html', 'about/index.html', 'article/index.html', 'notes/other/index.html']) {
      const html = await output(file)
      assert.equal(/<ul>[\s\S]*?<\/ul>/.exec(html)?.[0], /<ul>[\s\S]*?<\/ul>/.exec(news)?.[0])
      assert.match(html, /&lt;script&gt;title&lt;\/script&gt;/)
      assert.match(html, /&lt;script&gt;tag&lt;\/script&gt;/)
      assert.match(html, /Issue\|published\|true/)
      assert.match(html, /src="\/notes\/news\/pic-4w.webp"/)
      assert.match(html, /class="articles">Article<\/p>/)
      assert.match(html, /class="featured"><\/p>/)
      assert.doesNotMatch(html, /<script>/)
    }
    assert.match(news, /class="neighbours">\|<\/p>/)
  })

  it('uses a note’s template and URL overrides while retaining its note type', async () => {
    await put('content/notes/news.md', note('template: page\nurlPath: /journal/news/\n'))
    await put(
      'theme/templates/page.chase',
      '<!doctype html><title>{ meta.title }</title>' +
        '<p>{ type }|{ template }|{ urlPath }</p><a href="{ noteList[0].urlPath }">note</a>{@raw html.markup}',
    )
    await quietly(() => build(dir, 'publish'))
    assert.match(await output('journal/news/index.html'), /note\|page\|\/journal\/news\//)
    assert.match(await output('journal/news/index.html'), /href="\/journal\/news\/"/)
  })

  it('gives every article list surface the page’s external link', async () => {
    await put('content/articles/[a]/a.md', page('title: A\npublishFrom: 2020-03-29\nlink: https://example.org/a\n'))
    await put('content/articles/[b]/b.md', page('title: B\npublishFrom: 2020-03-28\nlink: https://example.org/b\n'))
    await put('config.lima', (await readFile(join(dir, 'config.lima'), 'utf8')) + 'featured_articles:\n  - id: a\n')
    const template =
      '<!doctype html><title>{ meta.title }</title><body>' +
      '<p class="articles">{#each articleList as a}{ a.link }|{/each}</p>' +
      '<p class="featured">{#each featuredList as a}{ a.link }|{/each}</p>' +
      '<p class="feed">{#each feed.items as a}{ a.link }|{/each}</p>' +
      '<p class="neighbours">{ newer.link }|{ older.link }</p></body>'
    for (const name of ['home', 'article']) await put(`theme/templates/${name}.chase`, template)
    await quietly(() => build(dir, 'publish'))
    assert.match(await output('index.html'), /class="featured">https:\/\/example.org\/a\|<\/p>/)
    assert.match(await output('index.html'), /class="articles">https:\/\/example.org\/b\|<\/p>/)
    assert.match(await output('index.html'), /class="feed">https:\/\/example.org\/a\|https:\/\/example.org\/b\|<\/p>/)
    assert.match(await output('a/index.html'), /class="neighbours">\|https:\/\/example.org\/b<\/p>/)
    assert.match(await output('b/index.html'), /class="neighbours">https:\/\/example.org\/a\|<\/p>/)
  })

  it('keeps headings, footnotes and drawings in separate documents (review 3.3)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><g id="icon"><rect width="90" height="90"/></g></defs><use href="#icon"/></svg>'
    await put('theme/i18n/en.lima', 'drawing:\n  enlarge: Enlarge\n')
    for (const id of ['n1', 'n2']) {
      await put(
        `content/notes/[${id}]/${id}.md`,
        note(
          'title: Note\n',
          '## Same Heading\n\nText[^1].\n\n<m data-svg=inline>![Chart](chart.svg)</m>\n\n[^1]: Footnote text.\n',
        ),
      )
      await put(`content/notes/[${id}]/chart.svg`, svg)
    }
    await quietly(() => build(dir, 'publish'))
    for (const id of ['n1', 'n2']) {
      const html = await output(`notes/${id}/index.html`)
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
      assert.equal(new Set(ids).size, ids.length)
      for (const expected of ['same-heading', 'note-1', 'note-1-ref', 'drawing.chart', 'drawing.chart.icon'])
        assert.ok(ids.includes(expected), expected)
      assert.match(html, /href="#drawing.chart.icon"/)
      assert.match(await output(`notes/${id}/index.html.md`), /chart.svg/)
      assert.equal(await output(`notes/${id}/chart.svg`), svg)
    }
    assert.doesNotMatch(await output('index.html'), /same-heading|drawing.chart|note-1/)
  })

  it('honours type and template overrides, without granting a solitary note a bundle (review 4.1)', async () => {
    await put('content/notes/hijack.md', note('type: article\ntemplate: article\n'))
    const site = await load(true)
    assert.equal(site.content.en!.pages.hijack!.articleLike, true)
    assert.deepEqual(notesFor(site, 'en', true), [])
    await quietly(() => build(dir, 'publish'))
    assert.match(await output('feed.xml'), /\/hijack\//)
    assert.match(await output('hijack/index.html'), /short/)
  })

  it('rejects a second home, including a note with template: home (review 4.2)', async () => {
    await put('content/notes/fake-home.md', note('template: home\ndescription: HIJACKED\n'))
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /has two home pages/,
    )
  })

  it('ignores an archived note with template: home when choosing the llms.txt description (review 4.2)', async () => {
    await put('content/notes/fake-home.md', note('status: archived\ntemplate: home\ndescription: HIJACKED\n'))
    await quietly(() => build(dir, 'publish'))
    assert.doesNotMatch(await output('llms.txt'), /HIJACKED/)
  })

  it('rejects the occupied root URL before a note can replace robots.txt (review 4.3)', async () => {
    await put('content/notes/[root-note]/root-note.md', note('urlPath: /\n', '# Root Note\n\n[Robots](robots.txt)\n'))
    await put('content/notes/[root-note]/robots.txt', 'User-agent: *\nDisallow: / # FROM NOTE')
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /index.html.*both|both.*index.html/,
    )
  })

  it('links its own syntax stylesheet when its text contains code (review 4.4)', async () => {
    await put(
      'config.lima',
      (await readFile(join(dir, 'config.lima'), 'utf8')) + 'highlighting:\n  theme: github-light\n',
    )
    await put('content/notes/code-note.md', note('', '# Code Note\n\n```rust\nlet x = 1;\n```\n'))
    const template =
      '<!doctype html><title>{ meta.title }</title><head>{#if hasCode}' +
      '<link rel="stylesheet" href="{ assets[\'/assets/css/syntax-highlighting.css\'] }">{/if}</head>' +
      '<body>{@raw html.markup}</body>'
    await put('theme/templates/note.chase', template)
    await quietly(() => build(dir, 'publish'))
    assert.match(await output('notes/code-note/index.html'), /rel="stylesheet"/)
    assert.match(await output('notes/code-note/index.html'), /class="shiki/)
    assert.doesNotMatch(await output('index.html'), /class="shiki/)
  })

  it('rejects duplicate page ids across roots (review 4.5)', async () => {
    await put('content/notes/about.md', note())
    await assert.rejects(load(), /id about is .*already/)
  })
})

describe('link on every page (reviews 2.1 and 3.1)', () => {
  for (const root of ['pages', 'articles', 'essays', 'notes']) {
    it(`accepts external https on ${root} and exposes it on the page and list entries`, async () => {
      await put(`content/${root}/[external]/external.md`, note('link: https://example.org/issue\n'))
      const site = await load(true)
      assert.equal(site.content.en!.pages.external!.metadata.link, 'https://example.org/issue')
      assert.ok(!site.problems.some((p) => /link/.test(p.message)))
    })
    it(`drops every refused link from ${root} in dev, including drafts and seeds`, async () => {
      const links = [
        'javascript:alert(1)',
        '//evil.example/',
        'http://example.org/',
        'mailto:x@example.org',
        'tel:123',
        '/internal/',
        'https://[bad]',
        'https:example.org',
        'https://notes.example/missing.pdf',
        'https://notes.example:444/',
        'https:///evil.example/triple-slash',
        'https://\\\\evil.example/backslash',
        'https://notes.example./same-host-dot',
        'https://external.example/path with spaces',
        'https://external.example/path\tand\nnewlines',
        'https://external.example/path\u0001control',
      ]
      for (const [i, link] of links.entries()) {
        const state = ['published', 'draft', 'seed'][i % 3]!
        await put(`content/${root}/[bad${i}]/bad${i}.md`, note(`status: ${state}\nlink: ${JSON.stringify(link)}\n`))
      }
      const site = await load()
      for (const p of Object.values(site.content.en!.pages)) assert.equal(p.metadata.link, undefined)
      assert.equal(site.problems.filter((p) => /field link/.test(p.message)).length, links.length)
      const template =
        '<!doctype html><title>{ meta.title }</title><body><a href="{ meta.link }">own</a>' +
        '{#each noteList as n}<a href="{ n.link }">note</a>{/each}' +
        '{#each articleList as n}<a href="{ n.link }">article</a>{/each}</body>'
      for (const name of ['home', 'page', 'article', 'essay', 'note'])
        await put(`theme/templates/${name}.chase`, template)
      await quietly(() => build(dir, 'dev'))
      for (let i = 0; i < links.length; i++) {
        const html = await output(`${root === 'notes' ? 'notes/' : ''}bad${i}/index.html`, 'dev')
        assert.doesNotMatch(html, /javascript:|evil.example|http:|mailto:|tel:|internal|missing.pdf/)
        assert.match(html, /href=""/)
      }
    })
  }
})

describe('link and a language’s own origin', () => {
  it('rejects a link to the language’s host, even when it differs from site.origin', async () => {
    await put(
      'config.lima',
      (await readFile(join(dir, 'config.lima'), 'utf8')).replace(
        '  de:\n',
        '  de:\n    origin: https://de.notes.example\n',
      ),
    )
    await put('content/pages/[about]/de/about.md', page('title: About\nlink: https://de.notes.example/missing/\n'))
    const site = await load()
    assert.equal(site.content.de!.pages.about!.metadata.link, undefined)
    assert.ok(site.problems.some((p) => /link must name another site/.test(p.message)))
  })
})

describe('bundle boundaries (reviews 1.1 and 1.2)', () => {
  for (const location of ['notes', 'notes/@series']) {
    for (const type of ['note', 'article']) {
      it(`refuses every file named by a solitary ${type} in ${location}`, async () => {
        const files = [
          '[other-note]/secret.pdf',
          'draft-note.md',
          '_private.md',
          'README.md',
          '@series/[col-note]/col-secret.pdf',
          'pic.png',
          'chart.svg',
        ]
        for (const file of files) await put(`content/${location}/${file}`, 'PRIVATE')
        await put(
          `content/${location}/evil.md`,
          note(
            `type: ${type}\n`,
            '# Evil\n\n' +
              files
                .slice(0, 5)
                .map((file) => `[Secret](${file})`)
                .join('\n\n') +
              '\n\n![Picture](pic.png)\n\n<m data-svg=inline>![Chart](chart.svg)</m>\n',
          ),
        )
        // Ignore sibling Markdown as pages, while keeping the exact hostile file requests.
        await put(`content/${location}/draft-note.md`, note('status: draft\n'))
        await assert.rejects(
          quietly(() => build(dir, 'publish')),
          /evil.md:[\s\S]*has no bundle/,
        )
        await quietly(() => build(dir, 'dev'))
        assert.deepEqual(await readdir(join(dir, '.hadley/dev', type === 'note' ? 'notes/evil' : 'evil')), [
          'index.html',
        ])
        const html = await output(`${type === 'note' ? 'notes/' : ''}evil/index.html`, 'dev')
        assert.doesNotMatch(html, /href="[^#][^"]*"|src="|PRIVATE/)
      })
    }
  }

  for (const field of ['cover', 'og:image']) {
    it(`refuses a solitary note’s ${field} file`, async () => {
      await put('content/notes/evil.md', note(`${field}: pic.png\n`))
      await put('content/notes/pic.png', 'PRIVATE')
      await assert.rejects(
        quietly(() => build(dir, 'publish')),
        /has no bundle/,
      )
    })
  }

  for (const root of ['articles', 'essays', 'pages', 'notes']) {
    it(`keeps ${root}/@series[1]/[evil-bundle] inside its bundle`, async () => {
      await put(
        `content/${root}/@series[1]/[evil-bundle]/evil.md`,
        note('', '# Evil\n\n[Parent secret](col-secret.pdf)\n\n[Sibling secret]([sibling]/sib-secret.pdf)\n'),
      )
      await put(`content/${root}/@series[1]/col-secret.pdf`, 'PRIVATE')
      await put(`content/${root}/@series[1]/[sibling]/sib-secret.pdf`, 'PRIVATE')
      await assert.rejects(
        quietly(() => build(dir, 'publish')),
        /col-secret.pdf does not exist/,
      )
    })
  }
})

describe('category labels (review 2.2)', () => {
  it('takes only own theme keys as labels, in every language and on every page type', async () => {
    for (const root of ['articles', 'essays', 'pages', 'notes']) {
      for (const category of ['constructor', '__proto__', 'toString', 'valueOf', 'issue']) {
        const id = `${root}-${category}`
        for (const file of [`content/${root}/[${id}]/${id}.md`, `content/${root}/[${id}]/de/${id}.md`])
          await put(file, note(`category: ${category}\ntags: [constructor, __proto__, toString]\n`))
      }
    }
    const site = await load()
    for (const lang of ['en', 'de']) {
      for (const p of Object.values(site.content[lang]!.pages)) {
        const category = p.metadata.category
        if (!category) continue
        assert.equal(
          categoryLabel(site.locales[lang]!, category),
          category === 'issue' ? (lang === 'en' ? 'Issue' : 'Problem') : category,
        )
      }
    }
    assert.ok(site.content.de!.taxonomy.tags.constructor!.length > 0)
    const own = Object.assign(Object.create(null) as Record<string, string>, { constructor: 'Own label' })
    assert.equal(categoryLabel({ categories: own }, 'constructor'), 'Own label')
  })
})

describe('notes review round 2', () => {
  it('puts notes under notes/ by type, preserves other types and overrides, and leaves room for the list page', async () => {
    await put('content/pages/[notes]/notes.md', page('title: Notes\n'))
    await put('content/articles/[typed-note]/typed.md', note('type: note\n'))
    await put('content/articles/[typed-note]/de/notiz.md', note('type: note\n'))
    await put('content/notes/[typed-page]/plain.md', note('type: page\n'))
    await put('content/notes/news.md', note())
    const site = await load(true)
    assert.equal(site.content.en!.pages.notes!.urlPath, '/notes/')
    assert.equal(site.content.en!.pages['typed-note']!.urlPath, '/notes/typed/')
    assert.equal(site.content.de!.pages['typed-note']!.urlPath, '/de/notes/notiz/')
    assert.equal(site.content.en!.pages['typed-page']!.urlPath, '/plain/')
    await quietly(() => build(dir, 'publish'))
    for (const path of [
      'notes/index.html',
      'notes/news/index.html',
      'notes/typed/index.html',
      'de/notes/notiz/index.html',
    ])
      assert.match(await output(path), /<title>/)
  })

  it('orders notes on the same calendar day by id, regardless of publication time', async () => {
    await put('content/notes/aaa.md', page('publishFrom: "2020-03-01T08:00:00Z"\ntitle: AAA\n'))
    await put('content/notes/zzz.md', page('publishFrom: "2020-03-01T20:00:00Z"\ntitle: ZZZ\n'))
    const site = await load(true)
    const entries = notesFor(site, 'en', true)
    assert.deepEqual(
      entries.map((entry) => entry.title),
      ['AAA', 'ZZZ'],
    )
    assert.equal(entries[0]!.ageDays, entries[1]!.ageDays)
  })

  it('keeps only articles and essays in a series shared across roots', async () => {
    await put('content/articles/@tools-of-the-trade/[winkelhaken]/winkelhaken.md', note('', '# Winkelhaken\n'))
    await put('content/essays/@tools-of-the-trade/[satzschiff]/satzschiff.md', note('', '# Satzschiff\n'))
    await put('content/notes/@tools-of-the-trade/hijack-note.md', note('', '# Hijacked Note\n'))
    await put('content/pages/@tools-of-the-trade/[extra]/extra.md', page('title: Extra\n'))
    const template =
      '<!doctype html><title>{ meta.title }</title>' +
      '{#each seriesData as series}<p>{ series.total }</p>' +
      '{#each series.items as item}<a href="{ item.urlPath }">{ item.title }</a>{/each}{/each}'
    for (const name of ['article', 'essay', 'note', 'page']) await put(`theme/templates/${name}.chase`, template)
    for (const mode of ['publish', 'dev'] as const) {
      await quietly(() => build(dir, mode))
      for (const slug of ['winkelhaken', 'satzschiff']) {
        const html = await output(`${slug}/index.html`, mode)
        assert.match(html, /<p>2<\/p>/)
        assert.match(html, /Winkelhaken/)
        assert.match(html, /Satzschiff/)
        assert.doesNotMatch(html, /Hijacked Note|Extra/)
      }
      assert.doesNotMatch(await output('notes/hijack-note/index.html', mode), /<a /)
    }
  })

  for (const [first, second] of [
    ['articles/[only-de]/only-de.md', 'notes/[only-de]/de/hijack.md'],
    ['articles/[pilcrow]/pilcrow.md', 'notes/[pilcrow]/_v.md'],
    ['articles/@one/[duplicate]/one.md', 'articles/@two/[duplicate]/de/two.md'],
    ['articles/[solitary]/solitary.md', 'notes/solitary.md'],
    ['articles/[part]/_v.md', 'notes/[part_v]/de/hijack.md'],
  ]) {
    it(`rejects bundle and page id collisions between ${first} and ${second}`, async () => {
      await put(`content/${first}`, note())
      await put(`content/${second}`, note())
      for (const publish of [false, true]) {
        await assert.rejects(load(publish), (error: Error) => {
          assert.ok(error.message.includes(first), error.message)
          assert.ok(error.message.includes(second), error.message)
          assert.match(error.message, /id .*already/)
          return true
        })
      }
    })
  }

  it('keeps translations and variants within the same bundle', async () => {
    await put('content/notes/[news]/news.md', note())
    await put('content/notes/[news]/de/nachricht.md', note())
    await put('content/notes/[news]/_v.md', note())
    const site = await load(true)
    assert.deepEqual(site.translationMappings.news, { en: '/notes/news/', de: '/de/notes/nachricht/' })
    assert.deepEqual(site.content.en!.pages.news!.variants, { v: 'news_v' })
  })

  it('normalizes link before rendering and records it once per page alongside external content links', async () => {
    await put(
      'content/notes/news.md',
      note(
        'link: HTTPS://EXTERNAL.example:443/a/../issue\n',
        '# News\n\n[Issue](https://external.example/issue)\n\n[Other](https://other.example/)\n',
      ),
    )
    const site = await load(true)
    assert.equal(site.content.en!.pages.news!.metadata.link, 'https://external.example/issue')
    assert.equal(notesFor(site, 'en', true)[0]!.link, 'https://external.example/issue')
    renderContent(site, true)
    const expected = [
      { url: 'https://external.example/issue', pages: [{ id: 'news', lang: 'en' }] },
      { url: 'https://other.example/', pages: [{ id: 'news', lang: 'en' }] },
    ]
    assert.deepEqual(JSON.parse(linksJson(site)), expected)
    await put(
      'theme/templates/note.chase',
      '<!doctype html><title>{ meta.title }</title><a href="{ meta.link }">Issue</a>',
    )
    await quietly(() => build(dir, 'publish'))
    assert.match(await output('notes/news/index.html'), /href="https:\/\/external.example\/issue"/)
    assert.deepEqual(JSON.parse(await readFile(join(dir, '.hadley/links.json'), 'utf8')), expected)
  })

  it('rejects all language hosts, including trailing dots, even without content in that language', async () => {
    await put(
      'config.lima',
      (await readFile(join(dir, 'config.lima'), 'utf8')).replace(
        '  de:\n',
        '  fr:\n    origin: https://fr.notes.example\n  de:\n    origin: https://de.notes.example\n',
      ),
    )
    for (const [id, link] of [
      ['other-lang', 'https://de.notes.example/other-lang-origin'],
      ['other-lang-dot', 'https://de.notes.example./other-lang-origin'],
      ['no-content', 'https://fr.notes.example./no-content'],
    ])
      await put(`content/notes/${id}.md`, note(`link: ${link}\n`))
    await put('content/pages/[about]/de/about.md', page('title: About\nlink: https://notes.example/default-origin\n'))
    const site = await load()
    assert.equal(site.content.en!.pages['other-lang']!.metadata.link, undefined)
    assert.equal(site.content.en!.pages['other-lang-dot']!.metadata.link, undefined)
    assert.equal(site.content.de!.pages.about!.metadata.link, undefined)
    assert.equal(site.content.en!.pages['no-content']!.metadata.link, undefined)
    assert.equal(site.content.fr, undefined)
    assert.equal(site.problems.filter((problem) => /link must name another site/.test(problem.message)).length, 4)
    await assert.rejects(
      quietly(() => build(dir, 'publish')),
      /link must name another site/,
    )
  })
})

describe('an explicitly empty title', () => {
  for (const root of ['articles', 'essays', 'notes', 'pages']) {
    for (const text of ['# Heading\n', 'Body.\n']) {
      it(`rejects an empty title in ${root} with ${text.trim()}, even with a configured default`, async () => {
        await put(
          'config.lima',
          (await readFile(join(dir, 'config.lima'), 'utf8')).replace(
            'metadata:\n',
            'metadata:\n  title:\n    defaultValue: Default title\n',
          ),
        )
        await put(`content/${root}/[empty]/empty.md`, note("title: ''\n", text))
        const site = await load(true)
        assert.equal(site.content.en!.pages.empty!.metadata.title, '')
        assert.throws(() => settle(site.problems, true), /title/)
      })
    }
  }
})
