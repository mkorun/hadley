import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import { init } from '../init.ts'

// The articles next to an article (docs/themes.md "Newer and older"): hems with its starter, whose articles are, newest
// first, the table by the window, the galley, the composing stick and the pilcrow.

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-neighbours-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The URL paths an article's page links as older (rel=prev) and newer (rel=next). */
const linked = (html: string) => ({
  older: html.match(/class="pager-older"\s+href="([^"]+)"/)?.[1] ?? null,
  newer: html.match(/class="pager-newer"\s+href="([^"]+)"/)?.[1] ?? null,
})

describe('an article', () => {
  it("links the articles before and after it in the home page's list, and nothing past either end", async () => {
    const site = join(dir, 'hems')
    await init(site, ['en'], 'hems', 'hems')
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await build(site, 'publish')
    } finally {
      process.stdout.write = write
    }
    const page = (path: string) => readFile(join(site, '.hadley', 'publish', path, 'index.html'), 'utf-8')
    assert.deepEqual(linked(await page('table-by-the-window')), { older: '/galley/', newer: null })
    assert.deepEqual(linked(await page('galley')), { older: '/composing-stick/', newer: '/table-by-the-window/' })
    assert.deepEqual(linked(await page('pilcrow')), { older: null, newer: '/composing-stick/' })
    assert.deepEqual(linked(await page('about')), { older: null, newer: null })
  })
})
