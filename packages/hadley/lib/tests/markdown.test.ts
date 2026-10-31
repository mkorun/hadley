import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseLima } from '@limaformat/lima'
import sharp from 'sharp'
import { build } from '../../index.ts'
import { textContentType } from '../dev-server.ts'

const dirs: string[] = []
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))

const template = `<galley:config>{"images":{"default":{"widths":[1],"formats":["webp"],"sizes":"100vw","quality":80}}}</galley:config>
<!doctype html><html><head><title>{ meta.title }</title></head><body>
{#if markdownUrl}<a class="markdown" href="{ markdownUrl }">Markdown</a>{/if}{@raw html.markup}</body></html>`

const page = (front: string, body = 'Text.\n') => `---\n${front}---\n${body}`

async function site(name: string, enabled: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `hadley-markdown-${name}-`))
  dirs.push(root)
  const config = `site:
  origin: https://markdown.example
  default:
    language: en
    title: Markdown
metadata:
  title:
    aliases: [titel]
  description:
    aliases: [beschreibung]
  author:
    aliases: [autor]
  private:
    aliases: [privat]
  comments:
${enabled ? 'markdown:\n  enabled: true\n' : ''}`
  const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .png()
    .toBuffer()
  const files: Record<string, string | Buffer> = {
    'config.lima': config,
    'theme/templates/page.chase': template,
    'theme/templates/article.chase': template,
    'theme/templates/home.chase': template,
    'content/pages/[home]/home.md': page('title: Home\nurlPath: /\ntemplate: home\n'),
    'content/pages/[target]/target.md': page('title: Target\n'),
    'content/pages/[target]/de/ziel.md': page('title: Ziel\n'),
    'content/articles/[source]/source.md': page(
      `titel: Source
beschreibung: Public description
publishFrom: 2026-01-02
updatedAt: 2026-02-03
autor: Ada
tags: [one, two]
privat: never publish
comments: false
`,
      `<!-- editor note -->

[Target]($target), [file](paper.pdf), [site](/target/), [outside](https://outside.example/x), [part](#part), [draft]($draft).

![pixel](pixel.png)

## Part {#part}

Body.
`,
    ),
    'content/articles/[source]/paper.pdf': Buffer.from('paper'),
    'content/articles/[source]/pixel.png': pixel,
    'content/pages/[hidden]/hidden.md': page('title: Hidden\nsitemap: false\n'),
    'content/pages/[plain]/plain.md': page('title: Plain\nmarkdown: false\n'),
    'content/pages/[draft]/draft.md': page('title: Draft\nstatus: draft\n'),
    'content/pages/[seed]/seed.md': page('title: Seed\nstatus: seed\n'),
    'content/pages/[later]/later.md': page('title: Later\npublishFrom: 2999-01-01\n'),
    'content/pages/[quiet]/quiet.md': page('title: Quiet\nnoindex: true\n'),
    'content/pages/@errors/[404]/404.md': page('title: Missing\nsitemap: false\n'),
    'content/pages/@errors/[503]/503.md': page('title: Maintenance\nsitemap: false\n'),
  }
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), contents)
  }
  return root
}

const quietBuild = async (root: string, mode: 'dev' | 'publish') => {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    return await build(root, mode)
  } finally {
    process.stdout.write = write
  }
}

describe('Markdown twins', () => {
  it('write public front matter and canonical content with absolute resolved destinations in every language', async () => {
    const root = await site('on', true)
    await quietBuild(root, 'publish')
    const out = join(root, '.hadley', 'publish')
    const twin = await readFile(join(out, 'source', 'index.html.md'), 'utf8')
    const [, front, markdown] = twin.split('---\n')
    assert.deepEqual(
      { ...(parseLima(front!) as Record<string, unknown>) },
      {
        title: 'Source',
        description: 'Public description',
        url: 'https://markdown.example/source/',
        language: 'en',
        published: new Date('2026-01-02'),
        updated: new Date('2026-02-03'),
        author: 'Ada',
        tags: ['one', 'two'],
      },
    )
    assert.equal(twin.endsWith('\n'), true)
    assert.match(markdown!, /^# Source\n/m)
    assert.doesNotMatch(twin, /editor note|private|comments/)
    assert.match(markdown!, /\[Target\]\(https:\/\/markdown\.example\/target\/\)/)
    assert.match(markdown!, /\[file\]\(https:\/\/markdown\.example\/source\/paper\.pdf\)/)
    assert.match(markdown!, /\[site\]\(https:\/\/markdown\.example\/target\/\)/)
    assert.match(markdown!, /\[outside\]\(https:\/\/outside\.example\/x\)/)
    assert.match(markdown!, /\[part\]\(#part\)/)
    assert.match(markdown!, /!\[pixel\]\(https:\/\/markdown\.example\/source\/pixel-1w\.webp\)/)
    assert.match(markdown!, /, draft\./)
    assert.doesNotMatch(markdown!, /\$draft/)
    assert.equal(
      await readFile(join(out, 'de', 'ziel', 'index.html.md'), 'utf8').then((s) => s.includes('language: "de"')),
      true,
    )
    assert.match(
      await readFile(join(out, 'source', 'index.html'), 'utf8'),
      /href="https:\/\/markdown\.example\/source\/index\.html\.md"/,
    )
    assert.match(await readFile(join(out, 'llms.txt'), 'utf8'), /https:\/\/markdown\.example\/source\/index\.html\.md/)
    const llms = await readFile(join(out, 'llms.txt'), 'utf8')
    assert.doesNotMatch(llms, /\/hidden\//)
    // a page that declines its twin stays in llms.txt, by its HTML page
    assert.match(llms, /https:\/\/markdown\.example\/plain\/\)/)
  })

  // review 2026-10-31: files were looked up by the wrong node: a picture in a quote stopped the build, and a video's
  // poster named the video
  it('resolve a picture in a quote and the preview of a video', async () => {
    const root = await site('nodes', true)
    await writeFile(
      join(root, 'content', 'articles', '[source]', 'source.md'),
      page(
        'title: Source\npublishFrom: 2026-01-01\n',
        '> ![pixel](pixel.png)\n\n<m video preview=pixel.png>[walk](walk.mp4)</m>\n',
      ),
    )
    await writeFile(join(root, 'content', 'articles', '[source]', 'walk.mp4'), 'video')
    await quietBuild(root, 'publish')
    const twin = await readFile(join(root, '.hadley', 'publish', 'source', 'index.html.md'), 'utf8')
    assert.match(twin, /!\[pixel\]\(https:\/\/markdown\.example\/source\/pixel-1w\.webp\)/)
    assert.doesNotMatch(twin, /preview=https:\/\/markdown\.example\/source\/walk/)
  })

  it('need the origin of the site', async () => {
    const root = await site('origin', true)
    const config = join(root, 'config.lima')
    await writeFile(config, (await readFile(config, 'utf8')).replace(/ *origin: .*\n/, ''))
    await assert.rejects(quietBuild(root, 'publish'), /site\.origin is missing/)
  })

  // ultrareview 2026-10-31: a twin that could not be made stopped the dev build
  it('are a problem of their page: a warning in a dev build, a fault in a publish build', async () => {
    const root = await site('fault', true)
    await writeFile(
      join(root, 'content', 'articles', '[source]', 'source.md'),
      page('title: Source\npublishFrom: 2026-01-01\n', '[gone]($missing).\n'),
    )
    const twin = join(root, '.hadley', 'dev', 'source', 'index.html.md')
    await mkdir(join(twin, '..'), { recursive: true })
    await writeFile(twin, 'of an earlier build')
    await quietBuild(root, 'dev')
    assert.equal(existsSync(twin), false)
    await assert.rejects(quietBuild(root, 'publish'), /cannot publish/)
  })

  it('write only published sitemap pages that allow a twin, and write deterministic bytes in dev too', async () => {
    const root = await site('selection', true)
    const first = await quietBuild(root, 'publish')
    // noindex keeps a page out of the sitemap, not out of llms.txt, so it has a twin as well
    const expected = ['de/ziel/index.html.md', 'quiet/index.html.md', 'source/index.html.md', 'target/index.html.md']
    assert.deepEqual(
      first.planned.filter((path) => path.endsWith('.md')),
      expected,
    )
    const before = await readFile(join(root, '.hadley', 'publish', 'source', 'index.html.md'))
    await quietBuild(root, 'publish')
    assert.deepEqual(await readFile(join(root, '.hadley', 'publish', 'source', 'index.html.md')), before)
    await quietBuild(root, 'dev')
    assert.deepEqual(await readFile(join(root, '.hadley', 'dev', 'source', 'index.html.md')), before)
  })

  it('stay off by default and keep llms.txt on HTML pages', async () => {
    const root = await site('off', false)
    const built = await quietBuild(root, 'publish')
    assert.deepEqual(
      built.planned.filter((path) => path.endsWith('.md')),
      [],
    )
    const llms = await readFile(join(root, '.hadley', 'publish', 'llms.txt'), 'utf8')
    assert.match(llms, /https:\/\/markdown\.example\/source\/\)/)
    assert.doesNotMatch(llms, /index\.html\.md/)
  })

  it('validate the page flag and claim a twin against bundle files', async () => {
    const invalid = await site('invalid-flag', true)
    await writeFile(join(invalid, 'content', 'pages', '[target]', 'target.md'), page('title: Target\nmarkdown: yes\n'))
    await assert.rejects(quietBuild(invalid, 'publish'), /front matter field markdown is not true or false/)

    const collision = await site('collision', true)
    await mkdir(join(collision, 'theme', 'static', 'target'), { recursive: true })
    await writeFile(join(collision, 'theme', 'static', 'target', 'index.html.md'), 'theme file\n')
    await assert.rejects(
      quietBuild(collision, 'publish'),
      /target\/index\.html\.md is written by both page en\/target: Markdown twin and theme:/,
    )
  })

  it('write no twins under maintenance', async () => {
    const root = await site('maintenance', true)
    await writeFile(
      join(root, 'config.lima'),
      `${await readFile(join(root, 'config.lima'), 'utf8')}maintenance:\n  enabled: true\n`,
    )
    const built = await quietBuild(root, 'publish')
    assert.deepEqual(
      built.planned.filter((path) => path.endsWith('.md')),
      [],
    )
  })

  it('serve the twin as UTF-8 Markdown', () => {
    assert.equal(textContentType('/source/index.html.md'), 'text/markdown; charset=utf-8')
    assert.equal(textContentType('/llms.txt'), 'text/plain; charset=utf-8')
  })
})
