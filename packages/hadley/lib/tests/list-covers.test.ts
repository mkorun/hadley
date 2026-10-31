import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import { init } from '../init.ts'

// The cover of a page as an entry of a list holds it (docs/themes.md "Covers"): hems with its starter, whose home
// page writes what its entries hold. Of its articles, only pilcrow has a cover.

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-list-covers-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

const entry = (list: string) =>
  `{#each ${list} as item}<i data-page="{ item.urlPath }" data-cover="{#if item.cover}{ item.cover.src } { item.cover.width }x{ item.cover.height } {#each item.cover.sources as source}{ source.type }={ source.srcset };{/each}{:else}none{/if}" data-ai="{ item.isAiCover }"></i>{/each}`

describe('an entry of a list', () => {
  it('holds the cover its page shows, with paths from the root, and null without one', async () => {
    const site = join(dir, 'hems')
    await init(site, ['en', 'de'], 'hems', 'hems')
    const home = join(site, 'theme', 'templates', 'home.chase')
    await writeFile(
      home,
      (await readFile(home, 'utf-8')).replace('</main>', `${entry('featuredList')}${entry('articleList')}</main>`),
    )
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await build(site, 'publish')
    } finally {
      process.stdout.write = write
    }
    const publish = join(site, '.hadley', 'publish')

    for (const [file, prefix] of [
      ['index.html', '/'],
      ['de/index.html', '/de/'],
    ] as const) {
      const html = await readFile(join(publish, file), 'utf-8')
      const entries = [...html.matchAll(/<i data-page="([^"]+)"\s+data-cover="([^"]*)"\s+data-ai="([^"]*)">/g)]
      assert.equal(entries.length, 4, `${file}: four articles`)
      const covered = entries.filter(([, , cover]) => cover !== 'none')
      assert.equal(covered.length, 1, `${file}: one cover`)
      const [, page, cover, ai] = covered[0]!
      assert.ok(page!.startsWith(prefix) && page!.includes('pilcrow'), `${file}: the cover is pilcrow's, not ${page}`)
      assert.equal(ai, 'false')
      const [src, size, sources] = cover!.split(' ', 3)
      assert.match(size!, /^\d+x\d+$/)
      assert.ok(src!.startsWith(page!), `${file}: ${src} lies under ${page}`)
      // every path the picture names is a file the build wrote
      const paths = [src!, ...sources!.split(';').flatMap((source) => source.split('=')[1]?.split(', ') ?? [])]
        .filter(Boolean)
        .map((candidate) => candidate.split(' ')[0]!)
      assert.ok(paths.length >= 2, `${file}: the srcset names its widths`)
      for (const path of paths) {
        assert.ok(path.startsWith(page!), `${file}: ${path} lies under ${page}`)
        await access(join(publish, decodeURIComponent(path)))
      }
    }
  })

  it("is the page's own cover too, which punch names as the search's picture of the page", async () => {
    const site = join(dir, 'punch')
    await init(site, ['en'], 'punch', 'punch')
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await build(site, 'publish')
    } finally {
      process.stdout.write = write
    }
    const publish = join(site, '.hadley', 'publish')
    const html = await readFile(join(publish, 'light-on-walls', 'index.html'), 'utf-8')
    const src = html.match(/<meta data-pagefind-meta="image\[content\]" content="([^"]+)">/)?.[1]
    assert.ok(src?.startsWith('/light-on-walls/'), `the picture lies under the page, not ${src}`)
    await access(join(publish, decodeURIComponent(src!)))
    const about = await readFile(join(publish, 'about', 'index.html'), 'utf-8')
    assert.ok(!about.includes('data-pagefind-meta="image'), 'a page without a cover names no picture')
  })
})
