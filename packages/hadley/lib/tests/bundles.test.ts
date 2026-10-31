import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pageFiles } from '../bundles.ts'

// The order of the pages decides the order of the sitemap and of pages with the same date: it must not depend on the
// order a file system lists a directory in, which differs between file systems and between Bun and Node.js.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-bundles-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const page = (...path: string[]) => {
  mkdirSync(join(dir, 'content', ...path.slice(0, -1)), { recursive: true })
  writeFileSync(join(dir, 'content', ...path), '---\ntitle: T\n---\n')
}

describe('pageFiles', () => {
  it('lists the bundles in the order of their names, whatever order the directory gives', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `a${String(29 - i).padStart(2, '0')}`)
    for (const id of ids) page('articles', `[${id}]`, `${id}.md`)
    const files = await pageFiles(join(dir, 'content'), 'articles', 'de')
    assert.deepEqual(
      files.map((f) => f.bundleId),
      [...ids].sort(),
    )
  })

  it('leaves out the files an operating system leaves', async () => {
    page('articles', '[a]', 'a.md')
    page('articles', '[a]', '._a.md')
    page('articles', '._[b]', 'b.md')
    writeFileSync(join(dir, 'content', 'articles', '.DS_Store'), '')
    const files = await pageFiles(join(dir, 'content'), 'articles', 'de')
    assert.deepEqual(
      files.map((f) => f.bundleId),
      ['a'],
    )
  })

  it("places a collection by its folder's name (@ before [), and a bundle's languages by theirs", async () => {
    page('articles', '[b]', 'b.md')
    page('articles', '[b]', 'fr', 'b.md')
    page('articles', '[b]', 'en', 'b.md')
    page('articles', '@series', '[a]', 'a.md')
    const files = await pageFiles(join(dir, 'content'), 'articles', 'de')
    assert.deepEqual(
      files.map((f) => `${f.collectionId ?? '-'}:${f.bundleId}:${f.language}`),
      ['series:a:de', '-:b:de', '-:b:en', '-:b:fr'],
    )
  })
})
