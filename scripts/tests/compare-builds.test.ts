import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectOutput,
  compareOutputs,
  copySite,
  entryOf,
  isSiteName,
  parseArgs,
  UsageError,
} from '../compare-builds.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-compare-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (path: string, content: string | Buffer = 'x') => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

describe('isSiteName', () => {
  it('accepts one path component and refuses anything that could leave a directory', () => {
    for (const name of ['teblo.de', 'my-site', 'a_b', 'x1']) assert.equal(isSiteName(name), true, name)
    for (const name of ['', '.', '..', '../x', 'a/b', '/abs', '.hidden', 'a\\b'])
      assert.equal(isSiteName(name), false, name)
  })
})

describe('entryOf', () => {
  it('finds the command line in packages/hadley, and at the root of a checkout from before', () => {
    write(join(dir, 'now', 'packages', 'hadley', 'hadley.ts'))
    write(join(dir, 'before', 'hadley.ts'))
    assert.equal(entryOf(join(dir, 'now')), join(dir, 'now', 'packages', 'hadley', 'hadley.ts'))
    assert.equal(entryOf(join(dir, 'before')), join(dir, 'before', 'hadley.ts'))
    assert.equal(entryOf(join(dir, 'neither')), null)
  })
})

describe('parseArgs', () => {
  const checkout = () => {
    write(join(dir, 'tool', 'hadley.ts'))
    return join(dir, 'tool')
  }

  it('refuses an empty selection', () => {
    const tool = checkout()
    mkdirSync(join(dir, 'sites'))
    assert.throws(() => parseArgs(['--ref', tool, '--sites', join(dir, 'sites')], tool), UsageError)
  })

  it('refuses a sites entry that is not a site, such as a broken symlink', () => {
    const tool = checkout()
    mkdirSync(join(dir, 'sites'))
    symlinkSync(join(dir, 'missing'), join(dir, 'sites', 'gone'))
    assert.throws(() => parseArgs(['--ref', tool, '--sites', join(dir, 'sites')], tool), /not a site/)
  })

  it('refuses a site name with a path in it, even when that path holds a site', () => {
    const tool = checkout()
    write(join(dir, 'elsewhere', 'config.lima'))
    mkdirSync(join(dir, 'sites'))
    assert.throws(() => parseArgs(['--ref', tool, '--sites', join(dir, 'sites'), '../elsewhere'], tool), /site name/)
  })

  it('builds the candidate from its own sites if given, and refuses them without the site', () => {
    const tool = checkout()
    write(join(dir, 'sites', 'a', 'config.lima'))
    write(join(dir, 'patched', 'a', 'config.lima'))
    mkdirSync(join(dir, 'empty'))
    const options = parseArgs(
      ['--ref', tool, '--sites', join(dir, 'sites'), '--candidate-sites', join(dir, 'patched')],
      tool,
    )
    assert.equal(options.sitesDir, join(dir, 'sites'))
    assert.equal(options.candidateSitesDir, join(dir, 'patched'))
    assert.equal(parseArgs(['--ref', tool, '--sites', join(dir, 'sites')], tool).candidateSitesDir, join(dir, 'sites'))
    assert.throws(
      () => parseArgs(['--ref', tool, '--sites', join(dir, 'sites'), '--candidate-sites', join(dir, 'empty')], tool),
      /not a site/,
    )
  })

  it('refuses a sites path that is a file', () => {
    const tool = checkout()
    write(join(dir, 'README.md'))
    assert.throws(() => parseArgs(['--ref', tool, '--sites', join(dir, 'README.md')], tool), UsageError)
  })
})

describe('copySite', () => {
  it('leaves out .hadley, .git and dist at the root only', () => {
    const site = join(dir, 'site')
    write(join(site, 'config.lima'))
    write(join(site, '.hadley', 'publish', 'index.html'))
    write(join(site, '.git', 'HEAD'))
    symlinkSync('.hadley/publish', join(site, 'dist'))
    write(join(site, 'theme', 'static', 'dist', 'app.js'))
    copySite(site, join(dir, 'copy'))
    assert.equal(existsSync(join(dir, 'copy', 'config.lima')), true)
    assert.equal(existsSync(join(dir, 'copy', '.hadley')), false)
    assert.equal(existsSync(join(dir, 'copy', '.git')), false)
    assert.equal(existsSync(join(dir, 'copy', 'dist')), false)
    assert.equal(existsSync(join(dir, 'copy', 'theme', 'static', 'dist', 'app.js')), true)
  })

  it('stops at a symlink inside the site', () => {
    const site = join(dir, 'site')
    write(join(site, 'config.lima'))
    write(join(dir, 'shared', 'a.md'))
    symlinkSync(join(dir, 'shared'), join(site, 'content'))
    assert.throws(() => copySite(site, join(dir, 'copy')), /symlink inside the site/)
  })
})

describe('collectOutput', () => {
  it('skips the search index at the publish root only and compares bytes', () => {
    const hadley = join(dir, '.hadley')
    write(join(hadley, 'publish', 'index.html'), 'a')
    write(join(hadley, 'publish', 'pagefind', 'index.js'), 'p')
    write(join(hadley, 'publish', 'guide', 'pagefind', 'index.html'), 'g')
    write(join(hadley, 'meta.json'), '{}')
    const files = collectOutput(hadley)
    assert.deepEqual([...files.keys()].sort(), ['meta.json', 'publish/guide/pagefind/index.html', 'publish/index.html'])
  })

  it('tells apart files that differ only in invalid UTF-8 bytes', () => {
    const one = join(dir, 'one', '.hadley')
    const two = join(dir, 'two', '.hadley')
    write(join(one, 'publish', 'raw.txt'), Buffer.from([0x80]))
    write(join(two, 'publish', 'raw.txt'), Buffer.from([0x81]))
    assert.deepEqual(compareOutputs(collectOutput(one), collectOutput(two)), ['differs:           publish/raw.txt'])
  })

  it('refuses a symlink in the output', () => {
    const hadley = join(dir, '.hadley')
    write(join(hadley, 'publish', 'index.html'))
    symlinkSync(join(hadley, 'publish', 'index.html'), join(hadley, 'publish', 'link.html'))
    assert.throws(() => collectOutput(hadley), /not a regular file/)
  })
})

describe('compareOutputs', () => {
  it('reports files missing on either side and files that differ', () => {
    const ref = new Map([
      ['a', '1'],
      ['b', '2'],
    ])
    const candidate = new Map([
      ['b', '3'],
      ['c', '4'],
    ])
    assert.deepEqual(compareOutputs(ref, candidate), [
      'differs:           b',
      'only in candidate: c',
      'only in ref:       a',
    ])
  })
})
