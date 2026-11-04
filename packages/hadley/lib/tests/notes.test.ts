import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from '../../index.ts'
import compileTemplates, { compileHeading, compileNote } from '../compile-templates.ts'
import loadSite from '../load-site.ts'
import { notesFor } from '../notes.ts'
import { Output } from '../output.ts'
import { writePages } from '../write-pages.ts'
import { settle } from '../problems.ts'
import { renderContent } from '../render-content.ts'

let dir: string
const page = (front: string, text = 'Text.\n') => `---\n${front}---\n${text}`
const note = (front = '', text = '# News\n\nA **short** piece.\n') => page(`publishFrom: 2020-03-28\n${front}`, text)
const options = () => ({
  includes: {
    basedir: join(dir, 'theme', 'templates'),
    import: (path: string, enc: string) => readFile(path, enc as BufferEncoding),
  },
})
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
    '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>{@raw html.notes}</body></html>',
  )
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
    ['empty title', note("title: ''\n", 'Text.\n'), /title/],
    ['blank title with invalid subtitle', note("title: '  '\nsubtitle: [bad]\n", 'Text.\n'), /requires a title/],
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

  it('refuses link on any other page, even when config.lima declares the field', async () => {
    const config = await readFile(join(dir, 'config.lima'), 'utf8')
    await put('config.lima', config.replace('  detail:\n', '  detail:\n  link:\n'))
    await put('content/pages/[about]/about.md', page('title: About\nlink: https://example.org\n'))
    const site = await load(true)
    assert.throws(
      () => settle(site.problems, true),
      /about\.md:\d+: the front matter field link is allowed only on a note/,
    )
  })

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
    assert.equal(notesFor(site, 'en', true).list.find((entry) => entry.id === 'news')?.link, 'https://example.org/news')
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
    const en = notesFor(site, 'en', true).list
    assert.deepEqual(
      en.map((entry) => entry.id),
      ['latest', 'A', 'a', 'z'],
    )
    assert.deepEqual(
      notesFor(site, 'de', true).list.map((entry) => entry.id),
      ['a'],
    )
    const a = en.find((entry) => entry.id === 'a')!
    assert.deepEqual(Object.keys(a).sort(), [
      'ageDays',
      'category',
      'categoryLabel',
      'id',
      'isDraft',
      'link',
      'meta',
      'publishFrom',
      'tags',
      'title',
    ])
    assert.deepEqual(a, {
      id: 'a',
      title: 'News',
      publishFrom: new Date('2020-03-28'),
      link: '',
      category: 'issue',
      categoryLabel: 'Issue',
      tags: ['tools', 'go'],
      ageDays: 2,
      meta: {
        publishFrom: new Date('2020-03-28'),
        title: 'News',
        category: 'issue',
        tags: ['tools', 'go'],
        detail: 'Extra',
      },
      isDraft: false,
    })
    assert.equal(notesFor(site, 'de', true).list[0]!.categoryLabel, 'Problem')
  })

  it('lists only published notes when publishing, and all states in dev with drafts and seeds marked', async () => {
    for (const state of ['published', 'draft', 'seed', 'archived'])
      await put(`content/notes/${state}.md`, note(`status: ${state}\n`))
    await put('content/notes/future.md', page('publishFrom: 9999-01-01\ntitle: Future\n'))
    const site = await load(false)
    assert.deepEqual(
      notesFor(site, 'en', true).list.map((entry) => entry.id),
      ['published'],
    )
    const dev = notesFor(site, 'en', false).list
    assert.deepEqual(
      dev.map(({ id, isDraft }) => [id, isDraft]),
      [
        ['future', false],
        ['archived', false],
        ['draft', true],
        ['published', false],
        ['seed', true],
      ],
    )
    assert.ok(dev[0]!.ageDays < 0)
    assert.deepEqual(
      notesFor(await load(true), 'en', true).list.map((entry) => entry.id),
      ['published'],
    )
  })

  it('counts calendar days using the scheduling day, ignoring time of day and daylight saving', async () => {
    await put('content/notes/news.md', page('publishFrom: "2020-03-28T23:30:00Z"\ntitle: News\n'))
    const site = await load()
    site.today = '2020-03-30'
    assert.equal(notesFor(site, 'en', false).list[0]!.ageDays, 2)
    site.today = '2020-03-28'
    assert.equal(notesFor(site, 'en', false).list[0]!.ageDays, 0)
  })
})

describe('markup/note.sort and html.notes', () => {
  it('renders text with the existing heading hook and gives the note values, locale and language once per note', async () => {
    await put('content/notes/[news]/news.md', note('category: issue\ntags: [go]\ndetail: Extra\n'))
    await put('content/notes/[news]/de/neu.md', note('category: issue\n', '# Neu\n\nText.\n'))
    await put('content/notes/older.md', page('publishFrom: 2020-03-27\ntitle: Older\n', '## Section\n'))
    await put('theme/templates/markup/heading.sort', '<span>{ meta.lang }:{@raw html.text}</span>')
    await put(
      'theme/templates/markup/note.sort',
      "<article><h3>{ title }</h3><i>{ id }|{ publishFrom | dateFormat('yyyy-MM-dd') }|{ link }|{ category }|{ categoryLabel }|" +
        '{ tags[0] }|{ ageDays }|{ meta.detail }|{ isDraft }|{ t.label }|{ meta.lang }</i>{@raw html.text}</article>',
    )
    const site = await load(true)
    site.today = '2020-03-30'
    renderContent(site, true, undefined, await compileHeading(options()))
    const template = (await compileNote(options()))!
    let count = 0
    const counting = {
      ...template,
      render: (...args: Parameters<typeof template.render>) => {
        count++
        return template.render(...args)
      },
    }
    const en = notesFor(site, 'en', true, counting)
    assert.equal(count, 2)
    assert.match(en.html, /news\|2020-03-28\|\|issue\|Issue\|go\|2\|Extra\|false\|News\|en/)
    assert.match(en.html, /<p>A <strong>short<\/strong> piece\.<\/p>/)
    assert.match(en.html, /<h2 id="section"><span>en:Section<\/span><\/h2>/)
    assert.ok(en.html.indexOf('<h3>News</h3>') < en.html.indexOf('<h3>Older</h3>'))
    const de = notesFor(site, 'de', true, counting)
    assert.equal(count, 3)
    count = 0
    await writePages(
      await compileTemplates(options()),
      new Output(join(dir, 'out')),
      {
        site,
        feeds: [],
        assets: {},
        isPublish: true,
        og: false,
      },
      counting,
    )
    assert.equal(count, 3, 'two English pages share the notes rendered once for English')
    assert.match(de.html, /Problem\|\|2\|\|false\|Neues\|de/)
  })

  it('gives every page of a language the same notes; note titles and tags stay escaped in both template paths', async () => {
    await put(
      'content/notes/[news]/news.md',
      note(
        "title: '<script>title</script>'\ntags: ['<script>tag</script>']\ndetail: '<script>field</script>'\n",
        'A **short** piece.\n',
      ),
    )
    await put('content/notes/[news]/de/neu.md', note('', '# Nur Deutsch\n\nText.\n'))
    await put(
      'theme/templates/markup/note.sort',
      '<article><h3>{ title }</h3><b>{ tags[0] }</b><i>{ meta.detail }</i>{@raw html.text}</article>',
    )
    const template =
      '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>' +
      '<ul>{#each noteList as n}<li>{ n.title }:{ n.tags[0] }</li><li>{ n.meta.detail }</li>{/each}</ul>{@raw html.notes}</body></html>'
    await put('theme/templates/home.chase', template)
    await put('theme/templates/page.chase', template)
    const result = await quietly(() => build(dir, 'publish'))
    const html = await readFile(join(dir, '.hadley/publish/index.html'), 'utf8')
    const about = await readFile(join(dir, '.hadley/publish/about/index.html'), 'utf8')
    assert.equal(html.slice(html.indexOf('<body>')), about.slice(about.indexOf('<body>')))
    assert.match(html, /<li>&lt;script&gt;title&lt;\/script&gt;:&lt;script&gt;tag&lt;\/script&gt;<\/li>/)
    assert.match(html, /<h3>&lt;script&gt;title&lt;\/script&gt;<\/h3>/)
    assert.match(html, /<b>&lt;script&gt;tag&lt;\/script&gt;<\/b>/)
    assert.match(html, /<p>A <strong>short<\/strong> piece\.<\/p>/)
    assert.match(html, /<i>&lt;script&gt;field&lt;\/script&gt;<\/i>/)
    assert.match(html, /<li>&lt;script&gt;field&lt;\/script&gt;<\/li>/)
    assert.doesNotMatch(html, /<script>/)
    const de = await readFile(join(dir, '.hadley/publish/de/index.html'), 'utf8')
    assert.match(de, /Nur Deutsch/)
    assert.doesNotMatch(de, /&lt;script&gt;/)
    assert.deepEqual(result.searchable.sort(), ['about/index.html', 'de/index.html', 'index.html'])
    for (const file of ['sitemap.xml', 'feed.xml', 'de/feed.xml', 'llms.txt'])
      assert.doesNotMatch(await readFile(join(dir, '.hadley/publish', file), 'utf8'), /news|neu|<script>|Nur Deutsch/)
    assert.ok(!(await readdir(join(dir, '.hadley/publish'))).includes('news'))
  })

  it('keeps a note’s bundle files reachable from every page that embeds it', async () => {
    await put('content/notes/[news]/news.md', note('', '# News\n\n[Paper](paper.pdf)\n'))
    await put('content/notes/[news]/paper.pdf', 'A test document')
    await put('theme/templates/markup/note.sort', '<article>{@raw html.text}</article>')
    await quietly(() => build(dir, 'publish'))
    for (const file of ['index.html', 'about/index.html']) {
      const html = await readFile(join(dir, '.hadley/publish', file), 'utf8')
      assert.match(html, /<a href="\/news\/paper\.pdf">Paper<\/a>/)
    }
    assert.equal(await readFile(join(dir, '.hadley/publish/news/paper.pdf'), 'utf8'), 'A test document')
    assert.deepEqual(await readdir(join(dir, '.hadley/publish/news')), ['paper.pdf'])
  })

  it('leaves html.notes empty without the file, while noteList is available', async () => {
    await put('content/notes/news.md', note())
    assert.equal(await compileNote(options()), undefined)
    const site = await load()
    renderContent(site, false)
    const notes = notesFor(site, 'en', false)
    assert.equal(notes.list.length, 1)
    assert.equal(notes.html, '')
    await quietly(() => build(dir, 'publish'))
    assert.doesNotMatch(await readFile(join(dir, '.hadley/publish/index.html'), 'utf8'), /News|short/)
  })

  for (const raw of ['title', 'tags', 'meta.detail', 'noteList', 'html[meta.key]']) {
    it(`refuses {@raw ${raw}} in the note template`, async () => {
      await put('theme/templates/markup/note.sort', `{@raw ${raw}}`)
      await assert.rejects(compileNote(options()), /note\.sort: .* writes a value as HTML/)
    })
  }

  it('permits the theme’s own texts as HTML, as every template does', async () => {
    await put('content/notes/news.md', note())
    await put('theme/templates/markup/note.sort', '{@raw t.label}')
    const site = await load()
    site.locales.en!.label = '<em>Trusted theme text</em>'
    renderContent(site, false)
    assert.equal(notesFor(site, 'en', false, await compileNote(options())).html, '<em>Trusted theme text</em>')
  })

  it('checks included partials too, and names the note if rendering fails', async () => {
    await put('theme/templates/markup/note.sort', '{@partial partials/note.sort}')
    await put('theme/templates/partials/note.sort', '{@raw meta.detail}')
    await assert.rejects(compileNote(options()), /partials\/note\.sort: .* writes a value as HTML/)
    await put('content/notes/news.md', note())
    await put('theme/templates/markup/note.sort', '<a href="{ meta.detail }">x</a>')
    const site = await load()
    site.content.en!.pages.news!.metadata.detail = 'javascript:alert(1)'
    renderContent(site, false)
    const template = await compileNote(options())
    assert.throws(() => notesFor(site, 'en', false, template), /news\.md: rendered with templates\/markup\/note\.sort:/)
  })
})
