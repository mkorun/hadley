import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { build } from '../../index.ts'

// Maintenance (config.md, deploy.md): a publish build makes the 503 page alone, at / too, with a mark for the server.

let dir: string

async function files(root: string, all: Record<string, string | Buffer>) {
  for (const [file, text] of Object.entries(all)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), text)
  }
}

// a 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const page = (front: string, body: string) => `---\n${front}---\n${body}`

/** A site in two languages with a home page, an article, a 404 and, unless `without503`, a 503 page. */
async function site(name: string, maintenance: boolean, without503 = false) {
  const root = join(dir, name)
  await files(root, {
    'config.lima':
      'site:\n  origin: https://test.example\n  default:\n    language: en\n    title: Test\n' +
      'rss:\n  enabled: true\n' +
      (maintenance ? 'maintenance:\n  enabled: true\n' : ''),
    'content/pages/[home]/home.md': page('title: Home\nurlPath: /\n', 'Welcome.\n'),
    'content/articles/[first]/first.md': page('title: First\npublishFrom: 2026-01-01\n', 'Text.\n'),
    'content/pages/@errors/[404]/404.md': page('title: Not found\n', 'Gone.\n'),
    ...(without503
      ? {}
      : {
          'content/pages/@errors/[503]/503.md': page('title: Back soon\n', 'Tidying.\n\n![The loft](loft.png)\n'),
          'content/pages/@errors/[503]/loft.png': PNG,
          'content/pages/@errors/[503]/de/503.md': page('title: Gleich zurück\n', 'Wir räumen auf.\n'),
        }),
    'theme/templates/page.chase':
      '<galley:config>{"images":{"default":{"widths":[480],"formats":["webp"],"sizes":"100vw","quality":80}}}' +
      '</galley:config><!doctype html><title>{ meta.title }</title>{@raw html.markup}',
    'theme/templates/article.chase': '<!doctype html><title>{ meta.title }</title>{@raw html.markup}',
    'theme/templates/feed.chase': '<!doctype html><title>{ meta.title }</title>',
    'theme/assets/css/style.css': 'body { color: black; }\n',
  })
  return root
}

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const write = process.stdout.write.bind(process.stdout)
  const error = process.stderr.write.bind(process.stderr)
  process.stdout.write = () => true
  process.stderr.write = () => true
  try {
    return await work()
  } finally {
    process.stdout.write = write
    process.stderr.write = error
  }
}

const published = async (root: string) =>
  (await readdir(join(root, '.hadley', 'publish'), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(join(root, '.hadley', 'publish'), join(entry.parentPath, entry.name)))
    .sort()

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-maintenance-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a site under maintenance', () => {
  it('publishes its 503 page alone, in each language, at / too, with the mark for the server', async () => {
    const root = await site('on', true)
    await quiet(() => build(root, 'publish'))
    const out = await published(root)
    assert.deepEqual(
      out.filter((file) => !file.startsWith('assets/') && !file.endsWith('.webp')),
      [
        '.maintenance',
        '404.html',
        'de/404.html',
        'de/errors/503/index.html',
        'de/index.html',
        'errors/503/index.html',
        'index.html',
      ],
    )
    assert.ok(
      out.includes('assets/css/style.css') || out.some((file) => /^assets\/css\/style\.[0-9a-f]+\.css$/.test(file)),
    )
    const publish = join(root, '.hadley', 'publish')
    assert.equal(
      await readFile(join(publish, 'index.html'), 'utf8'),
      await readFile(join(publish, 'errors', '503', 'index.html'), 'utf8'),
    )
    assert.match(await readFile(join(publish, 'index.html'), 'utf8'), /<title>Back soon<\/title>/)
    assert.equal(await readFile(join(publish, '.maintenance'), 'utf8'), '')
  })

  it('names the files of an error page by absolute path, as the server shows it at any address', async () => {
    const root = await site('paths', true)
    await quiet(() => build(root, 'publish'))
    const html = await readFile(join(root, '.hadley', 'publish', 'index.html'), 'utf8')
    const sources = [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(', '))
    assert.ok(sources.length > 0, html)
    for (const source of sources) assert.match(source, /^\/errors\/503\//)
  })

  it('builds the whole site for the dev server, as ever', async () => {
    const root = await site('dev', true)
    await quiet(() => build(root, 'dev'))
    const dev = join(root, '.hadley', 'dev')
    for (const file of ['index.html', 'first/index.html', 'errors/404/index.html', 'errors/503/index.html', 'feed.xml'])
      assert.ok(existsSync(join(dev, file)), file)
    assert.ok(!existsSync(join(dev, '.maintenance')))
    assert.ok(!existsSync(join(dev, '404.html')))
  })

  it('stops a publish build without a 503 page to show', async () => {
    const root = await site('none', true, true)
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /maintenance is on, but the site has no page @errors\/\[503\]/,
    )
  })

  it('publishes the whole site, its 503 page among the others, once maintenance is off', async () => {
    const root = await site('off', false)
    await quiet(() => build(root, 'publish'))
    const out = await published(root)
    for (const file of [
      'index.html',
      'first/index.html',
      'errors/503/index.html',
      'sitemap.xml',
      'llms.txt',
      'feed.xml',
    ])
      assert.ok(out.includes(file), file)
    assert.ok(!out.includes('.maintenance'))
    // 404.html for a host with no rules: the default language's at the root; German has no 404 page of its own here
    const publish = join(root, '.hadley', 'publish')
    assert.equal(
      await readFile(join(publish, '404.html'), 'utf8'),
      await readFile(join(publish, 'errors', '404', 'index.html'), 'utf8'),
    )
    assert.ok(!out.includes('de/404.html'))
  })

  it('gives an error page its address itself, and takes no urlPath for it', async () => {
    const root = await site('address', false)
    await writeFile(
      join(root, 'content/pages/@errors/[404]/404.md'),
      page('title: Not found\nurlPath: /404/\n', 'Gone.\n'),
    )
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /an error page takes no urlPath; its address is \/errors\/404\//,
    )
  })

  it('takes maintenance as a switch: enabled: true or false', async () => {
    const root = await site('switch', false)
    await writeFile(
      join(root, 'config.lima'),
      (await readFile(join(root, 'config.lima'), 'utf8')) + 'maintenance: true\n',
    )
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /maintenance is a block with enabled: true or false/,
    )
  })
  // ultrareview 2026-10-31: a fault of another page kept a site from going into maintenance
  it('is not held up by what is wrong with a page it does not build', async () => {
    const root = await site('fault', true)
    await writeFile(
      join(root, 'content/articles/[first]/first.md'),
      page('title: First\npublishFrom: 2026-01-01\nsitemap: maybe\n', 'Text.\n'),
    )
    await quiet(() => build(root, 'publish'))
    assert.ok((await published(root)).includes('errors/503/index.html'))
  })

  // ultrareview 2026-10-31: the page linked a feed the build does not write
  it('offers its page no feed', async () => {
    const root = await site('feed', true)
    await writeFile(
      join(root, 'theme/templates/page.chase'),
      '<galley:config>{"images":{"default":{"widths":[480],"formats":["webp"],"sizes":"100vw","quality":80}}}' +
        '</galley:config><!doctype html><title>{ meta.title }</title>' +
        '{#if feed}<link rel="alternate" href="{ feed.url }">{/if}{@raw html.markup}',
    )
    await quiet(() => build(root, 'publish'))
    assert.doesNotMatch(await readFile(join(root, '.hadley/publish/errors/503/index.html'), 'utf8'), /rel="?alternate/)
  })

  // ultrareview 2026-10-31: the page's path stood in the address twice
  it('gives an error page the address of its own og image', async () => {
    const root = await site('og', true)
    await files(root, {
      'content/pages/@errors/[503]/503.md': page('title: Back soon\nog:image: share.png\n', 'Tidying.\n'),
      'content/pages/@errors/[503]/share.png': PNG,
      'theme/templates/page.chase': '<!doctype html><title>{ meta.title }</title><i data-og="{ ogImage }"></i>',
    })
    await quiet(() => build(root, 'publish'))
    assert.match(
      await readFile(join(root, '.hadley/publish/errors/503/index.html'), 'utf8'),
      /data-og="?https:\/\/test\.example\/errors\/503\/share\.png/,
    )
  })
})
