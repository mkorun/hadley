import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { stop as stopEsbuild } from 'esbuild'
import { close as closePagefind } from 'pagefind'
import sharp from 'sharp'
import { build } from '../../index.ts'
import { runPagefind } from '../search.ts'

// What a publish build writes and lists for a page (page.outputs in lib/load-site.ts): an archived page keeps its URL
// but is listed and linked nowhere and not indexed; a note has no page of its own, so nothing lists or links it.

const CONFIG = `site:
  origin: https://outputs.example
  default:
    language: de
    title: Outputs
    claim: A claim
rss:
  enabled: true
navigations:
  footer: [alt, notiz, aktuell]
featured_articles:
  - id: alt
  - id: notiz
`

const TEMPLATE = `<!DOCTYPE html>
<html lang="{ meta.lang }">
<head>
<title>{ meta.title }</title>
{#if meta.noindex}<meta name="robots" content="noindex">{/if}
{#each translations as url, lang}<link rel="alternate" hreflang="{ lang }" href="{ url }">{/each}
</head>
<body>
<nav>{#each navigations.footer as link}<a href="{ link.urlPath }">{ link.title }</a>{/each}</nav>
<ul>{#each articleList as item}<li><a href="{ item.urlPath }">{ item.title }</a></li>{/each}</ul>
<ul>{#each featuredList as item}<li><a href="{ item.urlPath }">{ item.title }</a></li>{/each}</ul>
{#each seriesData as series}<ol>{#each series.items as item}<li><a href="{ item.urlPath }">{ item.title }</a></li>{/each}</ol>{/each}
<ul>{#each site.taxonomy.tags.t as id}<li class="tag"><a href="{ site.pages[id].urlPath }">{ id }</a></li>{/each}</ul>
<ul>{#each site.collections.serie as id}<li><a href="{ site.pages[id].urlPath }">{ id }</a></li>{/each}</ul>
<ul>{#each site.pages.aktuell.variants as id}<li class="variant"><a href="{ site.pages[id].urlPath }">{ id }</a></li>{/each}</ul>
<main>{@raw html.markup}</main>
</body>
</html>
`

const page = (frontMatter: string, body = 'Text.\n') => `---\npublishFrom: 2026-01-01\n${frontMatter}---\n${body}`

const cwd = process.cwd()
let dir: string
let searchable: string[]
const out = (file: string) => join(dir, 'sites', 'outputs', '.hadley', 'publish', file)
/** The URLs of the pages the search index holds: each fragment is a gzipped "pagefind_dcd" record of one page. */
const indexed = async () => {
  const urls = []
  for (const file of await readdir(out('pagefind/fragment'))) {
    const record = gunzipSync(await readFile(out(`pagefind/fragment/${file}`))).toString('utf8')
    urls.push(JSON.parse(record.slice('pagefind_dcd'.length)).url)
  }
  return urls.sort()
}

/** A site `name` with the pages `content` (paths in content/), built for publishing without its log. */
async function publish(
  name: string,
  content: Record<string, string>,
  mode: 'publish' | 'dev' = 'publish',
  template = TEMPLATE,
  config = CONFIG,
): Promise<{ searchable: string[] }> {
  const root = join(dir, 'sites', name)
  for (const [file, text] of Object.entries({
    ...content,
    'pages/[home]/home.md': page('title: Start\nurlPath: /\ntemplate: home\n'),
  })) {
    await mkdir(join(root, 'content', file, '..'), { recursive: true })
    await writeFile(join(root, 'content', file), text)
  }
  await mkdir(join(root, 'theme', 'templates'), { recursive: true })
  await writeFile(join(root, 'theme', 'templates', 'article.chase'), template)
  await writeFile(join(root, 'theme', 'templates', 'home.chase'), template)
  await writeFile(join(root, 'config.lima'), config)
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    return await build(join('sites', name), mode)
  } finally {
    process.stdout.write = write
  }
}

const png = (path: string) =>
  sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .png()
    .toFile(path)

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-outputs-test-'))
  process.chdir(dir)
  ;({ searchable } = await publish('outputs', {
    'articles/[aktuell]/aktuell.md': page('title: Aktuell\ntags: [t]\n', 'Siehe [Alt]($alt) und [Notiz]($notiz).\n'),
    'articles/[aktuell]/_kurz.md': page('title: Kurz\nstatus: draft\n'),
    'articles/[aktuell]/en/aktuell.md': page('title: Current\nstatus: draft\n'),
    'articles/[alt]/alt.md': page('title: Alt\nstatus: archived\ntags: [t]\n'),
    'articles/[alt]/_knapp.md': page('title: Knapp\ntags: [t]\n'),
    'articles/@serie/[teil1]/teil1.md': page('title: Teil 1\n'),
    'articles/@serie/[teil2]/teil2.md': page('title: Teil 2\nstatus: archived\n'),
    'articles/@serie/[teil3]/teil3.md': page('title: Teil 3\n'),
    'notes/[notiz]/notiz.md': page('title: Notiz\n'),
  }))
})

after(async () => {
  // the Pagefind service a build started here keeps this directory as its own, which a later build needs
  await closePagefind()
  // so does esbuild's when this file is the first to build in its process, as each is under node --test
  await stopEsbuild()
  process.chdir(cwd)
  // a service ends in its own time after it is told to, and Windows removes no directory a process runs in
  await rm(dir, { recursive: true, force: true, maxRetries: 10 })
})

describe('the outputs of a page in a publish build', () => {
  it('keep an archived page under its URL, marked for search engines not to index it', async () => {
    assert.match(await readFile(out('alt/index.html'), 'utf8'), /<meta name="robots" content="noindex">/)
    assert.doesNotMatch(await readFile(out('aktuell/index.html'), 'utf8'), /noindex/)
  })

  // review 2026-10-24: the sitemap and llms.txt listed archived pages, and llms.txt notes without a page
  it('list an archived page and a note nowhere: not in the sitemap, the feed, llms.txt or the search index', async () => {
    for (const file of ['sitemap.xml', 'feed.xml', 'llms.txt']) {
      const text = await readFile(out(file), 'utf8')
      assert.match(text, /outputs\.example\/aktuell\//, `${file} lists the current article`)
      assert.doesNotMatch(text, /outputs\.example\/alt\//, `${file} lists the archived page`)
      assert.doesNotMatch(text, /outputs\.example\/notiz\//, `${file} lists the note`)
    }
    const pages = ['aktuell/index.html', 'index.html', 'knapp/index.html', 'teil1/index.html', 'teil3/index.html']
    assert.deepEqual(searchable.sort(), pages)
    // review 2026-10-24 (follow-up): the test held only the plan; the index Pagefind writes holds those pages alone
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await runPagefind(out(''), searchable, join(dir, 'search-cache'))
    } finally {
      process.stdout.write = write
    }
    // review 2026-10-24 (final): the count alone let another page of the same number through
    assert.deepEqual(await indexed(), ['/', '/aktuell/', '/knapp/', '/teil1/', '/teil3/'])
  })

  it('leave a page marked noindex out of the sitemap, and keep it in the feed and the search index', async () => {
    const plain =
      '<html><head>{#if meta.noindex}<meta name="robots" content="noindex">{/if}</head><body>{@raw html.markup}</body></html>\n'
    const config =
      'site:\n  origin: https://outputs.example\n  default:\n    language: de\n    title: Outputs\nrss:\n  enabled: true\n'
    const { searchable: quiet } = await publish(
      'noindex',
      {
        'articles/[leise]/leise.md': page('title: Leise\nnoindex: true\n'),
        'articles/[laut]/laut.md': page('title: Laut\n'),
      },
      'publish',
      plain,
      config,
    )
    const file = (name: string) => readFile(join(dir, 'sites', 'noindex', '.hadley', 'publish', name), 'utf8')
    const sitemap = await file('sitemap.xml')
    assert.match(sitemap, /outputs\.example\/laut\//)
    assert.doesNotMatch(sitemap, /outputs\.example\/leise\//)
    assert.match(await file('feed.xml'), /outputs\.example\/leise\//)
    assert.ok(quiet.includes('leise/index.html'))
    assert.match(await file('leise/index.html'), /<meta name="robots" content="noindex">/)
  })

  it('take the search index of the same pages from the cache, and make it anew when a page changed', async () => {
    const cache = join(dir, 'search-cache-2')
    const files = async () => {
      const found = new Map<string, string>()
      for (const file of await readdir(out('pagefind'), { recursive: true }))
        if (file.includes('.')) found.set(file, (await readFile(out(`pagefind/${file}`))).toString('base64'))
      return found
    }
    await runPagefind(out(''), searchable, cache)
    const made = await files()
    await writeFile(join(cache, 'pagefind', 'pagefind-entry.json'), '{"cached":true}')
    await runPagefind(out(''), searchable, cache)
    assert.equal((await files()).get('pagefind-entry.json'), Buffer.from('{"cached":true}').toString('base64'))

    const page = await readFile(out('knapp/index.html'), 'utf8')
    try {
      await writeFile(out('knapp/index.html'), page.replace('</body>', '<p>Neu.</p></body>'))
      await runPagefind(out(''), searchable, cache)
      assert.notEqual((await files()).get('pagefind-entry.json'), Buffer.from('{"cached":true}').toString('base64'))
    } finally {
      await writeFile(out('knapp/index.html'), page)
    }
    await runPagefind(out(''), searchable, cache)
    assert.deepEqual(await files(), made)
  })

  // review 2026-10-24 (follow-up): the home page's lists linked archived articles, a navigation and a $id link
  // linked a note without a page, and the links between language versions named a draft
  it('link an archived page, a note and a draft nowhere: lists, series, navigations, language versions, $id links', async () => {
    const pages = ['index.html', 'aktuell/index.html', 'teil1/index.html', 'teil3/index.html']
    const html: Record<string, string> = {}
    for (const file of pages) html[file] = await readFile(out(file), 'utf8')
    for (const [file, text] of Object.entries(html)) {
      assert.doesNotMatch(
        text,
        /href="[^"]*\/(?:alt|notiz|teil2|en\/aktuell)\/"/,
        `${file} links a page nothing may link`,
      )
    }
    assert.match(html['index.html']!, /<li><a href="\/aktuell\/">Aktuell<\/a><\/li>/, 'the home page lists the article')
    assert.match(html['index.html']!, /<nav><a href="\/aktuell\/">Aktuell<\/a><\/nav>/)
    // review 2026-10-24 (final): a tag named a variant by its bundle, the archived page, and a page kept its draft
    // variant; templates that read site.taxonomy, site.collections or variants got ids of pages nothing may link
    const tagged = [...html['index.html']!.matchAll(/<li class="tag"><a href="([^"]*)">/g)].map((m) => m[1])
    assert.deepEqual(tagged.sort(), ['/aktuell/', '/knapp/'])
    assert.doesNotMatch(html['index.html']!, /class="variant"/)
    const series = /<ol>([\s\S]*?)<\/ol>/.exec(html['teil1/index.html']!)?.[1] ?? ''
    assert.deepEqual([...series.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort(), ['/teil1/', '/teil3/'])
    assert.match(html['aktuell/index.html']!, /<p>Siehe Alt und Notiz\.<\/p>/)
    assert.match(html['aktuell/index.html']!, /<link rel="alternate" hreflang="de" href="\/aktuell\/">/)
    assert.doesNotMatch(html['aktuell/index.html']!, /hreflang="en"/)
  })

  // review 2026-10-24 (final): sitelinks.json, which the editor tools read, decided state and pages on its own
  it('give the page list of a dev build the state load-site decided, and no note without a page', async () => {
    await publish(
      'dev',
      {
        'articles/[bald]/bald.md': '---\ntitle: Bald\npublishFrom: 2999-01-01\n---\nText.\n',
        'notes/[n]/n.md': page('title: N\n'),
      },
      'dev',
      TEMPLATE.replace(/^.*site\.pages\.aktuell.*$/m, ''),
    )
    const { pages } = JSON.parse(await readFile(join(dir, 'sites', 'dev', '.hadley', 'dev', 'sitelinks.json'), 'utf8'))
    assert.deepEqual(pages.map(({ id, status }: { id: string; status: string }) => [id, status]).sort(), [
      ['bald', 'scheduled'],
      ['home', 'published'],
    ])
  })

  // review 2026-10-24 (Fable): site.pages held every page, so a template could link a draft or show "" for a typo
  it('stop a template that asks for a page it may not show, naming the page and the template', async () => {
    const asks = (id: string) => TEMPLATE.replace('<main>', `<p>{ site.pages.${id}.urlPath }</p><main>`)
    const content = {
      'articles/[alt]/alt.md': page('title: Alt\nstatus: archived\n'),
      'articles/[neu]/neu.md': page('title: Neu\nstatus: draft\n'),
      'notes/[notiz]/notiz.md': page('title: Notiz\n'),
    }
    for (const [id, mode] of [
      ['alt', 'publish'],
      ['neu', 'publish'],
      ['notiz', 'dev'],
      ['tippfehler', 'dev'],
    ] as const) {
      await assert.rejects(
        publish(`asks-${id}`, content, mode, asks(id).replace(/^.*site\.pages\.aktuell.*$/m, '')),
        (error: Error) =>
          /: rendered with templates\/(article|home)\.chase: /.test(error.message) &&
          error.message.endsWith(`site.pages has no listed page "${id}" in the language de`),
      )
    }
    // a dev build shows a draft, marked
    await publish('asks-dev', content, 'dev', asks('neu').replace(/^.*site\.pages\.aktuell.*$/m, ''))
  })

  // Michael 2026-10-24: a feed per language; the feed page is the site's own, with the feed hadley gives templates
  // review 2026-10-25: a language whose pages a publish build leaves out still had a feed
  it('write a feed for each language with a page, and give every template the feed of its language', async () => {
    const template =
      '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>' +
      '<p class="feed">{ feed.url }:{#each feed.items as item}[{ item.title }|{ item.urlPath }]{/each}</p></body></html>'
    await publish(
      'feeds',
      {
        'articles/[a]/a.md': page('title: Deutsch\n'),
        'articles/[a]/en/a.md': page('title: English\n'),
        'articles/[b]/b.md': page('title: Entwurf\nstatus: draft\n'),
        'articles/[b]/fr/b.md': page('title: Brouillon\nstatus: draft\n'),
        'pages/[feed]/feed.md': '---\ntitle: Feed\ntemplate: article\nsitemap: false\n---\n',
        'pages/[feed]/en/feed.md': '---\ntitle: Feed\ntemplate: article\nsitemap: false\n---\n',
      },
      'publish',
      template,
    )
    const feeds = join(dir, 'sites', 'feeds', '.hadley', 'publish')
    const de = await readFile(join(feeds, 'feed.xml'), 'utf8')
    const en = await readFile(join(feeds, 'en', 'feed.xml'), 'utf8')
    assert.match(de, /<title>Deutsch<\/title>/)
    assert.doesNotMatch(de, /English|Entwurf/)
    assert.match(en, /<title>English<\/title>/)
    assert.match(en, /<atom:link href="https:\/\/outputs\.example\/en\/feed\.xml" rel="self"/)
    assert.match(en, /<language>en<\/language>/)
    assert.equal(existsSync(join(feeds, 'fr', 'feed.xml')), false)
    const page_ = (path: string) => readFile(join(feeds, path), 'utf8')
    assert.match(await page_('feed/index.html'), /<p class="feed">\/feed\.xml:\[Deutsch\|\/a\/\]<\/p>/)
    assert.match(await page_('en/feed/index.html'), /<p class="feed">\/en\/feed\.xml:\[English\|\/en\/a\/\]<\/p>/)
  })

  // Michael 2026-10-26: the dev server searches as the published site does
  it('write the search index in a dev build too, of the pages it lists, anew each build', async () => {
    const config = `${CONFIG}search:\n  enabled: true\n`
    const content = { 'articles/[a]/a.md': page('title: Eins\n'), 'articles/[b]/b.md': page('title: Zwei\n') }
    const template =
      '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>{@raw html.markup}</body></html>'
    await publish('dev-search', content, 'dev', template, config)
    const index = join(dir, 'sites', 'dev-search', '.hadley', 'dev', 'pagefind')
    const fragments = async () => (await readdir(join(index, 'fragment'))).length
    assert.ok(existsSync(join(index, 'pagefind-entry.json')))
    const first = await fragments()
    // another title gives the page another fragment; the one before must go
    const changed = { ...content, 'articles/[a]/a.md': page('title: Eins, geändert\n') }
    await publish('dev-search', changed, 'dev', template, config)
    assert.equal(await fragments(), first, 'an earlier build left its fragments')
    // review 2026-10-26: the count let any page through; each fragment is a gzipped "pagefind_dcd" record of one page
    const urls = []
    for (const file of await readdir(join(index, 'fragment'))) {
      const record = gunzipSync(await readFile(join(index, 'fragment', file))).toString('utf8')
      urls.push(JSON.parse(record.slice('pagefind_dcd'.length)).url)
    }
    assert.deepEqual(urls.sort(), ['/', '/a/', '/b/'])
  })

  // review 2026-10-26: a template wrote a value of the front matter into href unchecked (author.url: javascript:…);
  // galley stops at a value that begins a URL attribute with another scheme (G5001), in a field template too
  it('stop at a template that would write a URL of another scheme into a URL attribute', async () => {
    const template =
      '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>' +
      '{#if meta.author}<a href="{ meta.author.url }">{ meta.author.name }</a>{/if}{@raw html.markup}</body></html>'
    const author = 'title: Eins\nauthor:\n  name: X\n  url: javascript:alert(1)\n'
    await assert.rejects(
      publish('template-url', { 'articles/[a]/a.md': page(author) }, 'publish', template),
      /a\.md: rendered with templates\/article\.chase: G5001: href="javascript:alert\(1\)" is no URL a template may write there/,
    )
    const config = `${CONFIG}metadata:\n  quelle:\n    template: '<a href="{value}">Quelle</a>'\n`
    await assert.rejects(
      publish(
        'field-url',
        { 'articles/[a]/a.md': page('title: Eins\nquelle: //evil.example/x\n') },
        'dev',
        template,
        config,
      ),
      /a\.md: the field quelle: G5001: href="\/\/evil\.example\/x"/,
    )
    // review 2026-10-26 (perf): galley 0.3.0 read the template's text, and missed a URL in {#if}, after an empty
    // value and after a space
    for (const [name, attribute] of [
      ['url-if', '{#if meta.author}{ meta.author.url }{/if}'],
      ['url-empty', '{ meta.unset }{ meta.author.url }'],
      ['url-space', ' { meta.author.url }'],
    ]) {
      const wrapped = template.replace('<a href="{ meta.author.url }">', `<a href="${attribute}">`)
      await assert.rejects(publish(name!, { 'articles/[a]/a.md': page(author) }, 'publish', wrapped), /G5001/)
    }
  })

  // Michael 2026-10-26: the dev server reloads the page first and writes the search index after it
  it('leave the search index to the caller with deferSearch, and write it when called', async () => {
    const config = `${CONFIG}search:\n  enabled: true\n`
    const template =
      '<!DOCTYPE html><html><head><title>{ meta.title }</title></head><body>{@raw html.markup}</body></html>'
    const root = join(dir, 'sites', 'deferred')
    for (const [file, text] of Object.entries({
      'articles/[a]/a.md': page('title: Eins\n'),
      'pages/[home]/home.md': page('title: Start\nurlPath: /\ntemplate: home\n'),
    })) {
      await mkdir(join(root, 'content', file, '..'), { recursive: true })
      await writeFile(join(root, 'content', file), text)
    }
    await mkdir(join(root, 'theme', 'templates'), { recursive: true })
    for (const name of ['article', 'home']) await writeFile(join(root, 'theme', 'templates', `${name}.chase`), template)
    await writeFile(join(root, 'config.lima'), config)
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      const built = await build(join('sites', 'deferred'), 'dev', { deferSearch: true })
      const entry = join(root, '.hadley', 'dev', 'pagefind', 'pagefind-entry.json')
      assert.equal(existsSync(entry), false)
      await built.search!()
      assert.equal(existsSync(entry), true)
    } finally {
      process.stdout.write = write
    }
  })

  it('write no page for a note', () => {
    assert.equal(existsSync(out('notiz/index.html')), false)
  })

  // review 2026-10-24: a cover was accepted, but neither shown nor made into an og image
  it('fail a page whose cover nothing uses: the template shows none, and no og image is made', async () => {
    const cover = 'articles/[c]/c.md'
    await mkdir(join(dir, 'sites', 'cover', 'content', 'articles', '[c]'), { recursive: true })
    await png(join(dir, 'sites', 'cover', 'content', 'articles', '[c]', 'cover.png'))
    await assert.rejects(
      publish('cover', { [cover]: page('title: C\ncover: cover.png\n') }),
      /c\.md:\d+: cover cover\.png is used nowhere: the template article has no "cover" image config/,
    )
  })

  // services/forms/CONTRACT.md C10: the comments tool writes another language's comments into that language's folder
  it("show an article's comments in its language: the bundle's for the default, its language folder's for another", async () => {
    const withComments = `<!DOCTYPE html>\n<html lang="{ meta.lang }"><head><title>{ meta.title }</title></head>
<body><main>{@raw html.markup}</main>{@raw html.comments ?? ''}</body></html>\n`
    const bundle = join(dir, 'sites', 'comments', 'content', 'articles', '[k]')
    await mkdir(join(bundle, 'en'), { recursive: true })
    await writeFile(join(bundle, '_comments.html'), '<p class="c">Kommentar</p>')
    await writeFile(join(bundle, 'en', '_comments.html'), '<p class="c">Comment</p>')
    await publish(
      'comments',
      { 'articles/[k]/k.md': page('title: K\n'), 'articles/[k]/en/k.md': page('title: K en\n') },
      'publish',
      withComments,
      'site:\n  origin: https://comments.example\n  default:\n    language: de\n    title: Comments\n',
    )
    const html = (path: string) => readFile(join(dir, 'sites', 'comments', '.hadley', 'publish', path), 'utf8')
    assert.match(await html('k/index.html'), /<p class="c">Kommentar<\/p>/)
    assert.doesNotMatch(await html('k/index.html'), /Comment</)
    assert.match(await html('en/k/index.html'), /<p class="c">Comment<\/p>/)
    assert.doesNotMatch(await html('en/k/index.html'), /Kommentar/)
  })

  // docs/comments.md: the comments service names an article by its title and links to it from meta.json
  it("write meta.json with the site's origin and language and each article's id, language, title and path", async () => {
    const meta = JSON.parse(await readFile(join(dir, 'sites', 'outputs', '.hadley', 'meta.json'), 'utf8'))
    assert.equal(meta.origin, 'https://outputs.example')
    assert.equal(meta.language, 'de')
    const aktuell = meta.articles.find((a: { id: string }) => a.id === 'aktuell')
    assert.deepEqual([aktuell.lang, aktuell.title, aktuell.path], ['de', 'Aktuell', '/aktuell/'])
  })
})
