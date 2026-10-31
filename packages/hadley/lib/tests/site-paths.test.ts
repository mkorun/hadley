import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentPath, findContentFile, lookupDirs, urlPathProblem } from '../site-paths.ts'

describe('contentPath', () => {
  it('takes a decoded path inside the bundle as it is', () => {
    assert.deepEqual(contentPath('sub/a b.pdf'), { rel: 'sub/a b.pdf' })
  })

  it('refuses what is not a plain path inside the bundle', () => {
    for (const name of ['../a.png', 'sub/../a.png', './a.png', '/etc/hosts', 'a\\b.png', 'a//b.png', ''])
      assert.ok('refused' in contentPath(name), name)
  })

  it('refuses a file the operating system leaves, even when content names it', () => {
    for (const name of ['.DS_Store', 'sub/._photo.jpg', 'Thumbs.db', 'sub/desktop.ini'])
      assert.match((contentPath(name) as { refused: string }).refused, /operating system/, name)
  })
})

describe('findContentFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hadley-site-paths-test-'))
    mkdirSync(join(dir, '[b]', 'en'), { recursive: true })
    writeFileSync(join(dir, '[b]', 'root.png'), '')
    writeFileSync(join(dir, '[b]', 'both.png'), 'root')
    writeFileSync(join(dir, '[b]', 'en', 'both.png'), 'en')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('looks in the page directory, then in the bundle above a language directory', async () => {
    const page = join(dir, '[b]', 'en', 'page.md')
    assert.deepEqual(lookupDirs(page), [join(dir, '[b]', 'en'), join(dir, '[b]')])
    assert.deepEqual(await findContentFile(page, 'both.png'), {
      rel: 'both.png',
      source: join(dir, '[b]', 'en', 'both.png'),
    })
    assert.deepEqual(await findContentFile(page, 'root.png'), { rel: 'root.png', source: join(dir, '[b]', 'root.png') })
    assert.deepEqual(await findContentFile(page, 'none.png'), { refused: 'does not exist' })
  })

  it('does not look above a page that is not in a language directory', async () => {
    assert.deepEqual(lookupDirs(join(dir, '[b]', 'page.md')), [join(dir, '[b]')])
  })
})

describe('urlPathProblem', () => {
  it('accepts / and clean segments', () => {
    for (const urlPath of ['/', '/docs/guide/', '/en/über-mich/'])
      assert.equal(urlPathProblem(urlPath), undefined, urlPath)
  })

  it('names what is wrong', () => {
    assert.match(urlPathProblem('/a')!, /start and end/)
    assert.match(urlPathProblem('/../../escaped/')!, /\.\. segment/)
    assert.match(urlPathProblem('/a&b/')!, /one of/)
    assert.match(urlPathProblem('/a b/')!, /whitespace/)
  })

  it('refuses what a directory on Windows cannot be called', () => {
    for (const urlPath of ['/a:b/', '/a*b/', '/a|b/']) assert.match(urlPathProblem(urlPath)!, /one of/, urlPath)
    assert.match(urlPathProblem('/docs/v1./')!, /ends in \./)
    for (const urlPath of ['/a\u0001b/', '/a\u001fb/', '/a\u007fb/'])
      assert.match(urlPathProblem(urlPath)!, /control/, urlPath)
    for (const urlPath of ['/con/', '/docs/NUL/', '/com1/', '/lpt9.html/', '/aux.tar/', '/docs/com¹/', '/LPT³.txt/'])
      assert.match(urlPathProblem(urlPath)!, /reserves for a device/, urlPath)
    for (const urlPath of ['/console/', '/com10/', '/nullable/', '/v1.0/'])
      assert.equal(urlPathProblem(urlPath), undefined, urlPath)
  })
})
