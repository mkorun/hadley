import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { close as closePagefind } from 'pagefind'
import sharp from 'sharp'
import { parseDocument } from '../../case/index.ts'
import { build } from '../../index.ts'
import { blockIdMap, handleGet } from '../../addons/editor/plugin.ts'
import { registerPageBlocks } from '../../addons/editor/renderer.ts'

// The proof of the boundary in AGENTS.md (Security): hostile content goes through a whole publish build, from parsing
// through building its files and rendering to the templates, the sitemap, the feed and llms.txt. It cannot inject
// markup or script, it cannot make hadley read outside its bundle or write outside the output directory, and every
// file it names is built or fails the published page with the file named. The fixture holds every kind of node the
// parser gives a destination; the checks run over every file written, not over samples.

// Breaks out of an attribute and out of text, and holds what String.replace() would expand.
const X = `"><x-evil t=1>$&$'</x-evil>`
// A Markdown link, for llms.txt.
const LINK = ' [x](https://evil.example)'
// As Markanto writes it inside a double-quoted value.
const XQ = X.replace(/"/g, '\\"')

const CONFIG = `site:
  origin: https://hostile.example
  default:
    language: de
    title: Hostile
    claim: A claim
typography:
  enabled: true
rss:
  enabled: true
og:
  enabled: true
highlighting:
  theme: nord
navigations:
  footer: [entwurf, evil]
metadata:
  pixel:
    template: '<img src="https://pixel.example/{value}" alt="">'
  keywords:
`

const IMAGE = { widths: [4], formats: ['webp'], sizes: '100vw', quality: 80 }
const TEMPLATE = `<galley:config>${JSON.stringify({ images: { default: IMAGE, g: IMAGE, cover: IMAGE } })}</galley:config>
<!DOCTYPE html>
<html lang="{ meta.lang }">
<head>
<meta charset="utf-8">
<title>{ htmlTitle }</title>
<meta name="description" content="{ meta.description }">
<meta property="og:image" content="{ ogImage }">
<meta name="keywords" content="{ meta.keywords }">
{@raw html.jsonLd}
</head>
<body>
<h1>{ meta.title }</h1>
<p class="subtitle">{ meta.subtitle }</p>
{#if html.cover}{@raw html.cover}{/if}
<nav><ul>{#each toc as entry}<li><a href="#{ entry.id }">{ entry.text }</a></li>{/each}</ul></nav>
<main>{@raw html.markup}</main>
{@raw html.fields.pixel}
<footer>{#each navigations.footer as link}<a href="{ link.urlPath }">{ link.title }</a>{/each}</footer>
</body>
</html>
`

const page = (frontMatter: string, body: string) => `---\npublishFrom: 2026-01-01\n${frontMatter}---\n${body}`

const EVIL = page(
  `title: T${X}\nsubtitle: S${X}\ndescription: D${X}${LINK}\nhtmlTitle: H${X}\ncover: cover.png\npixel: P${X}\nkeywords:\n  - K${X}\n  - L\n`,
  `## Kopf${X}

Text ${X} und [Link ${X}]($entwurf) und ![inline${XQ}](a.png "Titel${XQ}").

<m lang=fr data-credit="${XQ}">![Alt${XQ}](a.png "Unterschrift${XQ}")</m>

<m group=g>![Gruppe${XQ}](a.png)\\
*Beschriftung ${X} ![innen${XQ}](f.png)*</m>

<m data-size=native>![nativ](sub/c.png)</m>

![Theme](/assets/t.png)

[PDF](paper.pdf?download=1#page=2)

<m video preview=poster.png>[Film](v.mp4)</m>

<m audio preview=poster.png>[Ton](t.mp3)</m>

<m embed>[Demo](https://example.com/embed)</m>

<m download>[Datei](paper.pdf)</m>

Siehe https://evil.example/auto und <m data-href=https://evil.example/data>Daten</m>.

\`\`\`html
${X}
\`\`\`

Fußnote.[^1]

[^1]: Notiz ${X}
`,
)

let dir: string
const cwd = process.cwd()
const write = process.stdout.write

const png = (path: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toFile(path)

const files = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))

/** A site `name` in `dir` whose one published article is `markdown`, with the files EVIL names. */
async function site(name: string, markdown: string): Promise<string> {
  const root = join(dir, 'sites', name)
  const bundle = join(root, 'content', 'articles', '[evil]')
  await mkdir(join(bundle, 'sub'), { recursive: true })
  await mkdir(join(root, 'content', 'articles', '[entwurf]'), { recursive: true })
  await mkdir(join(root, 'theme', 'templates'), { recursive: true })
  await mkdir(join(root, 'theme', 'assets'), { recursive: true })
  await writeFile(join(root, 'config.lima'), CONFIG)
  await writeFile(join(root, 'theme', 'templates', 'article.chase'), TEMPLATE)
  await png(join(root, 'theme', 'assets', 't.png'))
  // published as t.js (lib/site-paths.ts, themeOutputs)
  await writeFile(join(root, 'theme', 'assets', 't.ts'), 'export {}\n')
  // what og images need (lib/og.ts)
  await mkdir(join(root, 'theme', 'assets', 'images'), { recursive: true })
  await writeFile(
    join(root, 'theme', 'assets', 'images', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>',
  )
  await mkdir(join(root, 'theme', 'assets', 'css'), { recursive: true })
  await writeFile(
    join(root, 'theme', 'assets', 'css', 'style.css'),
    ':root { --og-background: #000000; --og-accent: #ffffff; }\n',
  )
  for (const image of ['a.png', 'f.png', 'cover.png', 'sub/c.png']) await png(join(bundle, image))
  await writeFile(join(bundle, 'paper.pdf'), 'pdf')
  await writeFile(join(bundle, 'v.mp4'), 'mp4')
  await writeFile(join(bundle, 't.mp3'), 'mp3')
  await writeFile(join(bundle, 'poster.png'), 'png')
  await writeFile(join(bundle, 'evil.md'), markdown)
  // files a bundle may hold under a name hadley writes itself
  await writeFile(join(bundle, 'index.html'), 'bundle')
  await writeFile(join(bundle, 'og.jpg'), 'bundle')
  await writeFile(join(bundle, 'a-4w.webp'), 'bundle')
  // a translation of the page, used by the case "language"
  if (name === 'language-draft') {
    await mkdir(join(bundle, 'en'))
    await writeFile(join(bundle, 'en', 'evil.md'), page('title: English\nstatus: draft\n', 'Text.\n'))
  }
  if (name === 'language') {
    await mkdir(join(bundle, 'en'))
    await writeFile(join(bundle, 'en', 'evil.md'), page('title: English\nurlPath: /same/\n', 'Text.\n'))
  }
  if (name === 'file-directory') {
    await mkdir(join(bundle, 'en'))
    await writeFile(join(bundle, 'en', 'evil.md'), page('title: English\nurlPath: /evil/sub/c.png/\n', 'Text.\n'))
  }
  if (name === 'search' || name === 'search-file')
    await writeFile(join(root, 'config.lima'), `${CONFIG}search:\n  enabled: true\n`)
  // the home page the feed links (lib/feed.ts)
  await mkdir(join(root, 'content', 'pages', '[home]'), { recursive: true })
  await writeFile(
    join(root, 'content', 'pages', '[home]', 'home.md'),
    page('title: Start\nurlPath: /\ntemplate: article\n', 'Willkommen.\n'),
  )
  await writeFile(
    join(root, 'content', 'articles', '[entwurf]', 'entwurf.md'),
    page('title: Entwurf\nstatus: draft\n', 'Noch nicht.\n'),
  )
  return root
}

/** Every file in `dir` outside the sites' .hadley directories, by its hash. */
async function outside(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const file of await files(dir)) {
    if (file.split('/').includes('.hadley')) continue
    out.set(
      file,
      createHash('sha256')
        .update(await readFile(join(dir, file)))
        .digest('hex'),
    )
  }
  return out
}

// what the last build claimed in its output directory (lib/output.ts)
let planned: string[] = []

/**
 * Builds `name` without the build log, which it returns; whether the build succeeds or fails, no file outside the
 * sites' .hadley directories is new, changed or gone afterwards.
 */

async function quietly(name: string, mode: 'dev' | 'publish', opts?: Parameters<typeof build>[2]): Promise<string> {
  const before = await outside()
  let log = ''
  process.stdout.write = (chunk: string | Uint8Array) => ((log += String(chunk)), true)
  try {
    ;({ planned } = await build(join('sites', name), mode, opts))
  } finally {
    process.stdout.write = write
    assert.deepEqual(await outside(), before, 'a file outside the output directory changed')
  }
  return log
}

/** Builds `name` for publishing; returns the files that are new in `dir` afterwards. */
async function publish(name: string): Promise<string[]> {
  const before = new Set(await files(dir))
  await quietly(name, 'publish')
  return (await files(dir)).filter((file) => !before.has(file))
}

const ORIGIN = 'https://hostile.example'

/** The URLs in a written HTML, XML or Markdown file: attributes, srcset, og:image, sitemap and feed links, links. */
function urlsIn(text: string): string[] {
  const urls: string[] = []
  for (const [, url] of text.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) urls.push(url!)
  for (const [, set] of text.matchAll(/\ssrcset="([^"]*)"/g)) {
    for (const candidate of set!.split(',')) urls.push(candidate.trim().split(' ')[0]!)
  }
  for (const [, url] of text.matchAll(/<meta property="og:image" content="([^"]*)"/g)) urls.push(url!)
  for (const [, url] of text.matchAll(/<(?:loc|link)>([^<]*)<\/(?:loc|link)>/g)) urls.push(url!)
  for (const [, url] of text.matchAll(/\]\(([^)\s]+)\)/g)) urls.push(url!)
  return urls.map(decode)
}

/**
 * What `url` in the written `file` is, read as a browser reads it on any origin (case/destination.ts): the
 * file of the site it names (`index.html` for a directory), `external` for an absolute URL of another site, or why
 * it is neither. Resolved against the file's path on two bases of other scheme and host, it must give one absolute
 * URL, or the same path on each base's own host.
 */
function target(file: string, url: string): { file: string } | 'external' | { wrong: string } {
  const a = URL.parse(url, `https://a.invalid/${file}`)
  const b = URL.parse(url, `http://b.invalid/${file}`)
  if (a === null || b === null) return { wrong: 'is not a URL' }
  if (a.href === b.href) {
    if (a.origin !== ORIGIN) return /^(https?|mailto|tel):$/.test(a.protocol) ? 'external' : { wrong: a.protocol }
  } else if (a.host !== 'a.invalid' || b.host !== 'b.invalid' || a.pathname !== b.pathname) {
    return { wrong: 'means something else on another origin' }
  }
  const path = decodeURIComponent(a.pathname).slice(1)
  return { file: path === '' || path.endsWith('/') ? `${path}index.html` : path }
}

const mockRequest = (url: string) => Object.assign(new Readable({ read() {} }), { url, method: 'GET' })
const mockResponse = () => {
  const res = { statusCode: 200, body: '', setHeader() {}, end: (body: string) => void (res.body = body) }
  return res
}

const decode = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-hostile-test-'))
  await writeFile(join(dir, 'secret.txt'), 'secret')
  process.chdir(dir)
})

after(async () => {
  // the Pagefind service a build started here keeps this directory as its own, which a later build needs
  await closePagefind()
  process.chdir(cwd)
  await rm(dir, { recursive: true, force: true })
})

describe('hostile content, through a whole publish build', () => {
  // review 2026-10-23: a page without a title was published under its id
  it('fails a published page without a title', async () => {
    await site('no-title', page('', 'Text.\n'))
    await assert.rejects(publish('no-title'), /evil\.md: has no title/)
  })

  // review 2026-10-24 (p1): a front matter LIMA rejected was dropped, and the draft it held was published
  it('fails a page whose front matter LIMA rejects, instead of publishing it without one', async () => {
    await site('bad-lima', page(`title: T\nstatus: draft\nlong: ${'x'.repeat(16385)}\n`, 'Text.\n'))
    await assert.rejects(publish('bad-lima'), /evil\.md:5: front matter: Lima: scalar exceeds maximum length/)
  })

  // review 2026-10-24: the {@raw} rule was not applied to the templates of fields
  it('refuses a field template of config.lima that writes its value as HTML', async () => {
    const root = await site('raw-field', page('title: F\npixel: P\n', 'Text.\n'))
    const config = (await readFile(join(root, 'config.lima'), 'utf8')).replace('{value}', '{@raw value}')
    await writeFile(join(root, 'config.lima'), config)
    await assert.rejects(publish('raw-field'), /the template of the field pixel: \{@raw value\} writes a value as HTML/)
  })

  // review 2026-10-24 (follow-up, p1): a field template's data is the front-matter value, so html.* there is content
  it('refuses a field template that writes html.* or t.*, which are content there', async () => {
    const root = await site('raw-field-html', page('title: F\npixel:\n  html:\n    x: <x-evil>\n', 'Text.\n'))
    for (const raw of ['{@raw html.x}', '{@raw t.x}']) {
      const config = (await readFile(join(root, 'config.lima'), 'utf8')).replace(/\{value\}|\{@raw [^}]*\}/, raw)
      await writeFile(join(root, 'config.lima'), config)
      await assert.rejects(publish('raw-field-html'), /writes a value as HTML; a field template writes none/)
    }
  })

  // review 2026-10-24: an embed's preview was an ignored attribute, a file the content names neither built nor failed
  it('fails a page that names a preview for an embed, which shows none', async () => {
    await site(
      'embed-preview',
      page('title: E\n', '<m embed preview=poster.png>[Demo](https://example.com/embed)</m>\n'),
    )
    await assert.rejects(publish('embed-preview'), /evil\.md: poster\.png cannot be the preview of an embed/)
  })

  // review 2026-10-24 (p1): a document past a budget of the parser was published as an empty page
  it('fails a page the Markanto parser gives up on at a resource limit', async () => {
    await site('budget', page('title: T\n', `${'> '.repeat(1001)}text\n`))
    await assert.rejects(publish('budget'), /evil\.md: the Markanto parser stopped at a resource limit/)
  })

  // review 2026-10-31 (before going public): a bundle's HTML file went out as a page of the site, script and all
  it('fails a page that names a document a browser would run, in any spelling', async () => {
    for (const name of ['a.html', 'b.HTM', 'c.xhtml', 'd.xml', 'e.mht']) {
      const root = await site('documents', page('title: D\n', `[file](${name})\n`))
      await writeFile(join(root, 'content', 'articles', '[evil]', name), '<script>alert(1)</script>')
      await assert.rejects(publish('documents'), (error: Error) => error.message.includes(`${name} is a document`))
      await rm(join(root, 'content', 'articles', '[evil]', name))
    }
  })

  it('publishes an SVG file a page links as it is', async () => {
    const root = await site('svg', page('title: S\n', '[file](s.svg)\n'))
    await writeFile(join(root, 'content', 'articles', '[evil]', 's.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    assert.ok((await publish('svg')).includes(join('sites', 'svg', '.hadley', 'publish', 'evil', 's.svg')))
  })

  it('copies an og:image the front matter names from the bundle and writes its absolute URL', async () => {
    await site('og-file', page('title: O\nog:image: f.png\n', 'Text.\n'))
    const written = await publish('og-file')
    assert.ok(written.includes(join('sites', 'og-file', '.hadley', 'publish', 'evil', 'f.png')))
    const html = await readFile(join('sites', 'og-file', '.hadley', 'publish', 'evil', 'index.html'), 'utf8')
    assert.match(html, /<meta property="og:image" content="https:\/\/hostile\.example\/evil\/f\.png">/)
  })

  it('injects no markup or script into what hadley writes, and every value stays text', async () => {
    const root = await site('hostile', EVIL)
    const written = await publish('hostile')
    const out = join(root, '.hadley', 'publish')

    for (const file of written.filter((f) => /\.(html|xml)$/.test(f))) {
      const text = await readFile(join(dir, file), 'utf8')
      assert.doesNotMatch(text, /<x-evil/, `${file}: an element from content`)
      assert.doesNotMatch(text, /\s(href|src)="javascript:/i, `${file}: a script URL from content`)
      // review 2026-10-25: a browser reads \\host, //host and /\host as another host
      assert.doesNotMatch(text, /\s(href|src)="(\/\/|\\|\/\\)/, `${file}: another host without a scheme`)
      assert.doesNotMatch(text, /<[a-z]+ [^>]*="[^"]*"[^>]*><x-evil|" x-evil=/, `${file}: an attribute breakout`)
    }

    const html = await readFile(join(out, 'evil', 'index.html'), 'utf8')
    const textOf = (pattern: RegExp) => decode(pattern.exec(html)?.[1] ?? '')
    // Typography may turn the quotes of a value into typographic ones; the rest stays as written, $& unexpanded.
    const kept = /^.[„“"]><x-evil t=1>\$&\$.<\/x-evil>$/
    assert.equal(textOf(/<title>([^<]*)<\/title>/), `H${X}`)
    // review 2026-10-24 (p1): galley 0.1.0 wrote an array or object of the front matter unescaped
    assert.equal(textOf(/<meta name="keywords" content="([^"]*)">/), `K${X},L`)
    assert.match(textOf(/<h1>([^<]*)<\/h1>/), kept)
    assert.match(textOf(/<p class="subtitle">([^<]*)<\/p>/), kept)
    assert.equal(
      textOf(/<meta name="description" content="([^"]*)">/).replace(LINK, ''),
      textOf(/<h1>([^<]*)/).replace(/^T/, 'D'),
    )
    assert.match(textOf(/<nav>[\s\S]*?<a [^>]*>([^<]*)<\/a>/), /^Kopf[„“"]><x-evil t=1>\$&\$.<\/x-evil>$/)
    assert.match(html, /data-credit="&quot;&gt;&lt;x-evil t=1&gt;\$&amp;\$'&lt;\/x-evil&gt;"/)
    // review 2026-10-23 (p1): a field template of config.lima took its value as HTML
    assert.equal(textOf(/<img src="https:\/\/pixel\.example\/([^"]*)" alt="">/), `P${X}`)
    assert.match(html, /<a href="paper\.pdf\?download=1#page=2">PDF<\/a>/)
    assert.doesNotMatch(html, /entwurf/i, 'a link to a draft is only its text, and no navigation lists it')
    assert.match(html, /<footer><a href="\/evil\/">/)

    // llms.txt is Markdown: a title is the text of its one link, a description holds no link or markup
    const llms = await readFile(join(out, 'llms.txt'), 'utf8')
    const entry = llms.split('\n').find((line) => line.startsWith('- [T')) ?? ''
    assert.match(
      entry,
      /^- \[T[^[\]]*\]\(https:\/\/hostile\.example\/evil\/\): D.* \\\[x\\\]\(https:\/\/evil\.example\)$/,
    )
    assert.doesNotMatch(llms, /(^|[^\\])<x-evil/)
    assert.ok(!llms.includes('[x](https://evil.example)'), 'a link from content')
    const feed = await readFile(join(out, 'feed.xml'), 'utf8')
    assert.match(decode(/<item>\s*<title>([^<]*)<\/title>/.exec(feed)?.[1] ?? ''), kept)
  })

  it('builds or copies every file the content names, and writes only into the output directory', async () => {
    const written = await publish('hostile')
    const outside = written.filter((file) => !file.startsWith(join('sites', 'hostile', '.hadley') + '/'))
    assert.deepEqual(outside, [])
    const out = join(dir, 'sites', 'hostile', '.hadley', 'publish')
    const built = new Set(await files(out))
    for (const file of ['evil/a-4w.webp', 'evil/f-4w.webp', 'evil/cover-4w.webp', 'evil/sub/c.png']) {
      assert.ok(built.has(file), `${file} is built`)
    }
    for (const file of ['evil/paper.pdf', 'evil/v.mp4', 'evil/og.jpg', 'assets/t.png', 'sitemap.xml', 'feed.xml']) {
      assert.ok(built.has(file), `${file} is written`)
    }
    assert.ok(![...built].some((file) => file.includes('secret')))
    // review 2026-10-24 (Fable): the registry recorded what was written; it is the plan of all of it
    assert.deepEqual([...built].sort(), planned)
  })

  // a translation's status was taken for the page's in every language, by its id
  it('publishes and links a page whose translation is a draft', async () => {
    const root = await site('language-draft', page('title: Deutsch\n', '[Selbst]($evil)\n'))
    await publish('language-draft')
    const html = await readFile(join(root, '.hadley', 'publish', 'evil', 'index.html'), 'utf8')
    assert.match(html, /<a href="\/evil\/">Selbst<\/a>/)
    assert.match(html, /<footer><a href="\/evil\/">Deutsch<\/a><\/footer>/)
  })

  // The kinds of node with a destination are read from the parser's own types: a new one fails here until the
  // fixture holds it (Fable 2026-10-23, section 5).
  it('holds in its fixture every kind of node the parser gives a destination', async () => {
    const parser = dirname(fileURLToPath(import.meta.resolve('@markantolang/parser/package.json')))
    const ast = await readFile(join(parser, 'dist', 'ast.d.ts'), 'utf8')
    const kinds = new Set(['autolink']) // its destination is its value
    for (const declaration of ast.split('export interface ').slice(1)) {
      const type = /^\s+type: '(\w+)';$/m.exec(declaration)?.[1]
      if (type && /^\s+(?:src|href|target)\??: /m.test(declaration)) kinds.add(type)
    }
    assert.deepEqual([...kinds].sort(), [
      'audioBlock',
      'autolink',
      'downloadBlock',
      'embedBlock',
      'imageBlock',
      'inlineImage',
      'link',
      'videoBlock',
    ])
    const seen = new Set<string>()
    const attributes = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (value === null || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      if (typeof node.type === 'string') seen.add(node.type)
      const attrs = node.attrs as { preview?: string; dataAttrs?: Record<string, string> } | undefined
      if (attrs?.preview !== undefined) attributes.add('preview')
      for (const key of Object.keys(attrs?.dataAttrs ?? {})) if (key.endsWith('href')) attributes.add('data-*href')
      Object.values(node).forEach(walk)
    }
    walk(parseDocument(EVIL, { bundlePath: '', lang: 'de' }).parsed)
    for (const kind of kinds) assert.ok(seen.has(kind), `the fixture has no ${kind}`)
    assert.deepEqual([...attributes].sort(), ['data-*href', 'preview'])
    assert.match(EVIL, /^cover: /m)
  })

  // review 2026-10-26 (Fable): the check skipped //host, so the proof excluded the case it was for; it now reads every
  // URL as a browser on any origin does
  it('writes no URL that a browser reads as another site, nor one to a file it did not write, in any file', async () => {
    const root = await site('hostile', EVIL)
    await publish('hostile')
    const out = join(root, '.hadley', 'publish')
    const written = new Set(await files(out))
    const missing: string[] = []
    let checked = 0
    for (const file of written) {
      if (!/\.(html|xml|txt)$/.test(file)) continue
      for (const url of urlsIn(await readFile(join(out, file), 'utf8'))) {
        const named = target(file, url)
        if (named === 'external') continue
        checked++
        if ('wrong' in named) missing.push(`${file}: ${url} ${named.wrong}`)
        else if (!written.has(named.file)) missing.push(`${file}: ${url}`)
      }
    }
    assert.deepEqual(missing, [])
    assert.ok(checked > 20, `only ${checked} local URLs`)
    // a preview is the poster of a video and the image of an audio, built like any file the content names
    const html = await readFile(join(out, 'evil', 'index.html'), 'utf8')
    assert.match(html, /<video controls poster="poster\.png">/)
    assert.match(html, /<img src="poster\.png" alt="" loading="lazy" decoding="async">\s*<audio controls>/)
  })

  it('writes JSON that parses back to the values content gave', async () => {
    const root = await site('hostile', EVIL)
    await publish('hostile')
    const kept = /^.[„“"]><x-evil t=1>\$&\$.<\/x-evil>$/
    const html = await readFile(join(root, '.hadley', 'publish', 'evil', 'index.html'), 'utf8')
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null')
    assert.match(ld.headline, kept)
    assert.match(ld.description, /^.[„“"]><x-evil t=1>\$&\$.<\/x-evil> \[x\]\(https:\/\/evil\.example\)$/)
    const meta = JSON.parse(await readFile(join(root, '.hadley', 'meta.json'), 'utf8'))
    assert.match(meta.articles.find((a: { id: string }) => a.id === 'evil').title, kept)
    const links = JSON.parse(await readFile(join(root, '.hadley', 'links.json'), 'utf8'))
    assert.ok(links.some((link: { url: string }) => link.url === 'https://evil.example/auto'))

    await quietly('hostile', 'dev')
    const dev = join(root, '.hadley', 'dev')
    const sitelinks = JSON.parse(await readFile(join(dev, 'sitelinks.json'), 'utf8'))
    assert.match(sitelinks.pages.find((p: { id: string }) => p.id === 'evil').title, kept)
    const siteJson = JSON.parse(await readFile(join(dev, 'site.json'), 'utf8'))
    assert.equal(siteJson.content.de.pages.evil.metadata.htmlTitle, `H${X}`)
  })

  it('gives the editor each block of a page exactly as its source holds it', async () => {
    const root = await site('editor', EVIL)
    await quietly('editor', 'dev', {
      blockEditorHook: (blocks, filePath, rawDoc) => registerPageBlocks(blocks, rawDoc, filePath),
    })
    const html = await readFile(join(root, '.hadley', 'dev', 'evil', 'index.html'), 'utf8')
    const texts: string[] = []
    for (const [, id] of html.matchAll(/data-hadley-id="([^"]*)"/g)) {
      assert.ok(blockIdMap.has(id!), `block ${id} is unknown to the editor`)
      const res = mockResponse()
      await handleGet(
        mockRequest(`/__hadley/block/${id}`) as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      )
      assert.equal(res.statusCode, 200)
      texts.push(JSON.parse(res.body).text)
    }
    assert.ok(texts.includes(`## Kopf${X}`))
    assert.ok(texts.includes(`\`\`\`html\n${X}\n\`\`\``))
    assert.ok(!texts.some((text) => text.includes('title:') || text.startsWith('# ')), 'the front matter or title')
  })

  it('reads nothing outside the bundle in a dev build either: a draft is shown without it, silently', async () => {
    const root = await site('dev-read', EVIL)
    await writeFile(
      join(root, 'content', 'articles', '[entwurf]', 'entwurf.md'),
      page('title: Entwurf\nstatus: draft\ncover: ../../../../../secret.txt\n', '[x](../../../../../secret.txt)\n'),
    )
    // a draft is meant to be unfinished (lib/problems.ts); its page shows what it lacks
    assert.doesNotMatch(await quietly('dev-read', 'dev'), /generate images .*⚠/)
    const dev = join(root, '.hadley', 'dev')
    const draft = await readFile(join(dev, 'entwurf', 'index.html'), 'utf8')
    assert.match(
      draft,
      /<!-- not built: \.\.\/\.\.\/\.\.\/\.\.\/\.\.\/secret\.txt is neither a page nor a file the site writes -->/,
    )
    const secret = await readFile(join(dir, 'secret.txt'))
    for (const file of await files(dev)) {
      assert.ok(!file.includes('secret'), file)
      assert.ok(!(await readFile(join(dev, file))).equals(secret), `${file} is a copy of secret.txt`)
    }
  })

  // review 2026-10-25: a URL the renderer blocked was a warning, so a page that lost a link to it was published
  it('shows a link of a scheme or host a page may not name as text in a dev build, and fails publishing it', async () => {
    const links = '[Skript](javascript:alert(1)) und [Fremd](//evil.example/x) und <m data-href=javascript:x>D</m>'
    const root = await site('blocked', page('title: Blockiert\n', `${links}\n`))
    assert.match(await quietly('blocked', 'dev'), /generate images .* 3 ⚠/)
    const html = await readFile(join(root, '.hadley', 'dev', 'evil', 'index.html'), 'utf8')
    assert.match(html, /Skript<!-- not built: javascript:alert\(1\) has a scheme a link may not have/)
    assert.match(html, /Fremd\s*<!-- not built: \/\/evil\.example\/x means something else on another origin -->/)
    assert.doesNotMatch(html, /href="(javascript:|\/\/)/)
    await assert.rejects(publish('blocked'), (err: unknown) => {
      const message = String(err instanceof Error ? err.message : err)
      assert.match(message, /javascript:alert\(1\) has a scheme a link may not have/)
      assert.match(message, /\/\/evil\.example\/x means something else on another origin/)
      assert.match(message, /javascript:x has a scheme a data-\* value may not have/)
      return true
    })
  })

  // review 2026-10-26: a cover sharp cannot read stopped every build, a draft's too
  it('fails publishing a page whose cover cannot be built, and shows a draft without it in a dev build', async () => {
    const root = await site('bad-cover', page('title: Cover\ncover: bad.png\n', 'Text.\n'))
    const bundle = join(root, 'content', 'articles', '[evil]')
    await writeFile(join(bundle, 'bad.png'), 'not an image')
    await assert.rejects(publish('bad-cover'), /evil\.md: cover bad\.png could not be built: /)
    await writeFile(join(bundle, 'evil.md'), page('title: Cover\nstatus: draft\ncover: bad.png\n', 'Text.\n'))
    assert.doesNotMatch(await quietly('bad-cover', 'dev'), /⚠/)
    // review 2026-10-26 (href): no warning alone passed with the draft left out of the build
    const html = await readFile(join(root, '.hadley', 'dev', 'evil', 'index.html'), 'utf8')
    assert.match(html, /<h1>Cover<\/h1>/)
    assert.match(html, /<p>Text\.<\/p>/)
    assert.doesNotMatch(html, /<picture|<img/)
  })

  // review 2026-10-24: no test rendered an error block, so writing its source unescaped would have passed
  it('shows a block the parser rejects in a dev build as text, never as markup', async () => {
    const root = await site('dev-error', page('title: Fehler\n', `Text.\n\n<m wrong>${X}</m>\n`))
    await quietly('dev-error', 'dev')
    const html = await readFile(join(root, '.hadley', 'dev', 'evil', 'index.html'), 'utf8')
    assert.match(html, /<div class="parse-error">[^<]*&lt;x-evil t=1&gt;/)
    assert.doesNotMatch(html, /<x-evil/)
  })

  // review 2026-10-29: read from a path, librsvg loads what an SVG's <image> names in the SVG's folder and below,
  // such as a picture of the bundle no page names, or of every bundle below the folder of a page that is one file
  it('makes no picture with the pixels of a file an SVG of the content names, whatever the SVG is called', async () => {
    const root = await site(
      'svg',
      page('title: SVG\ncover: disguised.png\n', '![Bild](pic.svg)\n\n![Getarnt](disguised.png)\n'),
    )
    const bundle = join(root, 'content', 'articles', '[evil]')
    const secret = join(bundle, 'unnamed.png')
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff0000ff' } })
      .png()
      .toFile(secret)
    const svg = (href: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${href}" width="8" height="8"/></svg>`
    await writeFile(join(bundle, 'pic.svg'), svg(`file://${secret}`))
    // sharp knows a picture by its bytes, not its name
    await writeFile(join(bundle, 'disguised.png'), svg('unnamed.png'))
    // as the command line builds it: from the site's absolute path, against which librsvg resolves a reference
    const before = await outside()
    process.stdout.write = () => true
    try {
      await build(root, 'publish')
    } finally {
      process.stdout.write = write
    }
    assert.deepEqual(await outside(), before, 'a file outside the output directory changed')
    const out = join(root, '.hadley', 'publish')
    const made = (await files(out)).filter((file) => /(pic|disguised|og)[^/]*\.(webp|avif|jpe?g|png)$/.test(file))
    assert.ok(made.length >= 3, `pictures made: ${made.join(', ')}`)
    for (const file of made) {
      const { data } = await sharp(join(out, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let i = 0; i < data.length; i += 4)
        assert.ok(
          !(data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60),
          `${file} shows the pixels of unnamed.png`,
        )
    }
  })

  // review 2026-10-25: the syntax stylesheet, the covers and the og images were planned after site paths were checked
  it('lets a page link to every file the build makes before any page renders', async () => {
    const links = '[s](/assets/css/syntax-highlighting.css) [c](/evil/cover-4w.webp) [o](/evil/og.jpg) [l](/llms.txt)'
    const root = await site(
      'made',
      page('title: Made\ncover: cover.png\n', `\`\`\`js\nlet a = 1\n\`\`\`\n\n${links}\n`),
    )
    await publish('made')
    const html = await readFile(join(root, '.hadley', 'publish', 'evil', 'index.html'), 'utf8')
    assert.match(html, /<a href="\/assets\/css\/syntax-highlighting\.[0-9a-f]{8}\.css">s<\/a>/)
    assert.match(html, /<a href="\/evil\/cover-4w\.webp">c<\/a> <a href="\/evil\/og\.jpg">o<\/a>/)
  })

  for (const [name, frontMatter, body, error] of [
    // a destination outside the bundle is the site path a browser resolves it to, which the site must write
    ['traversal', '', '[x](../../../../../secret.txt)\n', /\.\.\/secret\.txt is neither a page nor a file the site/],
    ['encoded', '', '[x](%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secret.txt)\n', /secret\.txt is neither a page nor a file/],
    // review 2026-10-25: spellings a browser resolves differently from how they read
    ['encoded-slash', '', '[x](/a%2Fb/)\n', /\/a%2Fb\/ holds an encoded \/ or \\ in a segment/],
    ['entity-id', '', '[x](&amp;#36;missing)\n', /&#36;missing does not exist/],
    ['relative-page', '', '[x](../nirgends/)\n', /\.\.\/nirgends\/ is neither a page nor a file the site writes$/],
    // review 2026-10-26: spellings that mean another site on another origin, an empty segment, and resources and
    // embeds that are this page or no URL
    ['self-sentinel', '', '[a](r)\n', /evil\.md:\d+: r does not exist/],
    ['self-sentinel-path', '', '[b](/q/r)\n', /evil\.md:\d+: \/q\/r is neither a page nor a file the site writes/],
    [
      'own-origin',
      '',
      '[x](https://hostile.example/nirgends.pdf)\n',
      /hostile\.example\/nirgends\.pdf is neither a page/,
    ],
    ['site-invalid', '', '[x](//site.invalid/evil/)\n', /\/\/site\.invalid\/evil\/ means something else on another/],
    ['scheme-slash', '', '[x](https:/other/)\n', /https:\/other\/ means something else on another origin/],
    ['empty-segment', '', '[x](/evil//)\n', /\/evil\/\/ has an empty segment/],
    ['download-self', '', '<m download>[x](/evil/)</m>\n', /\/evil\/ names a page, not a file/],
    ['image-self', '', '![x](?missing)\n', /\?missing names this page, not a file/],
    ['embed-bad', '', '<m embed>[x](https://[bad])</m>\n', /https:\/\/\[bad\] is not a URL/],
    ['missing', '', `![x](missing.png "${XQ}")\n`, /missing\.png does not exist/],
    ['theme', '', '![x](/assets/none.png)\n', /\/assets\/none\.png is neither a page nor a file the site writes/],
    ['site-path', '', '![x](/missing.png)\n', /\/missing\.png is neither a page nor a file the site writes/],
    ['theme-source', '', '[x](/assets/t.ts)\n', /\/assets\/t\.ts is neither a page nor a file the site writes/],
    // review 2026-10-24 (Fable): a mistyped $id and a site path that names nothing were published as written
    ['page-id', '', '[x]($tippfehler)\n', /\$tippfehler names no page/],
    [
      'page-path',
      '',
      '[x](/nirgends/) [y](/feed.xml)\n',
      /: \/nirgends\/ is neither a page nor a file the site writes$/,
    ],
    ['page-slash', '', '[x](/evil)\n', /\/evil is a page, whose path ends in \/$/],
    [
      'cover',
      'cover: ../../../../../secret.txt\n',
      'Text.\n',
      /cover \.\.\/.*secret\.txt is not the name of a file of/,
    ],
    ['og-image', 'og:image: javascript:alert(1)\n', 'Text.\n', /javascript:alert\(1\) is neither an http\(s\) URL nor/],
    ['urlpath', 'urlPath: /../x/\n', 'Text.\n', /urlPath \/\.\.\/x\//],
    ['parse-error', '', 'Text.\n\n<m wrong>text</m>\n', /cannot publish:\n\S+evil\.md:7: unknown resource attribute/],
    ['bundle-index', '', '[x](index.html)\n', /index\.html is a document a browser would run/],
    [
      'bundle-derivative',
      '',
      '![x](a.png)\n\n[y](a-4w.webp)\n',
      /evil\/a-4w\.webp is written by both page de\/evil: a\.png \(quality 80\) and page de\/evil: a-4w\.webp/,
    ],
    [
      'bundle-og',
      'cover: cover.png\n',
      '[x](og.jpg)\n',
      /evil\/og\.jpg is written by both page de\/evil: og\.jpg and page de\/evil: og image/,
    ],
    ['language', 'urlPath: /same/\n', 'Text.\n', /same\/\S+ is written by both page de\/evil.* and page en\/evil/],
    // review 2026-10-25: a directory a tool fills held every path below it
    ['search-file', '', '[x](/pagefind/not-written.js?x=1#frag)\n', /not-written\.js\?x=1#frag is neither a page nor/],
    [
      'search',
      'urlPath: /pagefind/\n',
      'Text.\n',
      /pagefind\/ is written by both page de\/evil and site: search index/,
    ],
    [
      'file-directory',
      '',
      '[x](sub/c.png)\n',
      /evil\/sub\/c\.png is a file of page de\/evil: sub\/c\.png and a directory of page en\/evil/,
    ],
  ] as const) {
    it(`fails the published page for a file it may not have or a path another owns (${name}), with both named`, async () => {
      await site(name, page(`title: ${name}\n${frontMatter}`, body))
      const before = new Set(await files(dir))
      await assert.rejects(publish(name), (err: unknown) => {
        assert.match(String(err instanceof Error ? err.message : err), error)
        return true
      })
      const outside = (await files(dir)).filter(
        (file) => !before.has(file) && !file.startsWith(join('sites', name, '.hadley') + '/'),
      )
      assert.deepEqual(outside, [])
      assert.ok(!(await files(join(dir, 'sites', name))).some((file) => file.includes('secret')))
    })
  }
})
