import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rootOption, siteLabel, siteRoot } from '../site-root.ts'

// Which site a command works on (README, "Dev-Server starten"): --root, else HADLEY_ROOT, else the nearest directory
// upwards with a config.lima.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-site-root-test-'))
  mkdirSync(join(dir, 'site', 'content', 'articles'), { recursive: true })
  writeFileSync(join(dir, 'site', 'config.lima'), 'site:\n')
  mkdirSync(join(dir, 'other'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('rootOption', () => {
  it('takes --root and its directory out of the arguments, wherever they stand', () => {
    assert.deepEqual(rootOption(['--root', 'x', 'dev', '--build']), { dir: 'x', rest: ['dev', '--build'] })
    assert.deepEqual(rootOption(['dev', '--root', 'x']), { dir: 'x', rest: ['dev'] })
    assert.deepEqual(rootOption(['dev']), { rest: ['dev'] })
  })

  it('stops when --root names no directory', () => {
    assert.throws(() => rootOption(['dev', '--root']), /--root needs the directory of a site/)
    assert.throws(() => rootOption(['--root', '--build']), /--root needs the directory of a site/)
  })
})

describe('siteRoot', () => {
  it('finds the nearest directory with a config.lima, from the current one upwards', () => {
    assert.equal(siteRoot(undefined, {}, join(dir, 'site')), join(dir, 'site'))
    assert.equal(siteRoot(undefined, {}, join(dir, 'site', 'content', 'articles')), join(dir, 'site'))
  })

  it('takes --root before HADLEY_ROOT, and HADLEY_ROOT before the search, relative to the current directory', () => {
    const env = { HADLEY_ROOT: join(dir, 'other') }
    assert.equal(siteRoot('site', env, dir), join(dir, 'site'))
    assert.equal(siteRoot(undefined, { HADLEY_ROOT: 'site' }, dir), join(dir, 'site'))
    assert.throws(() => siteRoot(undefined, env, join(dir, 'site')), /HADLEY_ROOT .*other is no site/)
  })

  it('stops with where it looked when there is no site', () => {
    assert.throws(() => siteRoot('other', {}, dir), /--root other: .*other is no site, it holds no config\.lima/)
    assert.throws(
      () => siteRoot(undefined, {}, join(dir, 'other')),
      /no site here: no config\.lima in .*other or above/,
    )
  })
})

describe('siteLabel', () => {
  it("names a site by its origin's host and its directory, else by its directory", () => {
    assert.equal(siteLabel('/s', { site: { origin: 'https://teblo.de' } }), 'teblo.de (/s)')
    assert.equal(siteLabel('/s', { site: { origin: 'no url' } }), '/s')
    assert.equal(siteLabel('/s', null), '/s')
  })
})
