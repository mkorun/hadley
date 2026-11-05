import assert from 'node:assert/strict'
import { it } from 'node:test'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserKey, isKey } from '../browser-key.ts'

// Windows keeps no mode bits (Node reports 0o666), and a link needs rights there: the user's own directory keeps the
// key file private (lib/platform.ts)
const windows = process.platform === 'win32'

it("keeps a site's key private and the same across restarts, one for each site", () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadley-key-'))
  try {
    const first = browserKey(dir, '/sites/a')
    assert.match(first.key, /^[0-9a-f]{64}$/)
    if (!windows) assert.equal(statSync(first.file).mode & 0o777, 0o600)
    assert.deepEqual(browserKey(dir, '/sites/a'), first)
    const other = browserKey(dir, '/sites/b')
    assert.notEqual(other.key, first.key)
    // a file that holds no key is replaced, not trusted
    writeFileSync(first.file, 'short\n')
    const replaced = browserKey(dir, '/sites/a')
    assert.match(replaced.key, /^[0-9a-f]{64}$/)
    assert.equal(readFileSync(first.file, 'utf8').trim(), replaced.key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('compares a key whole', () => {
  const key = 'a'.repeat(64)
  assert.ok(isKey(key, key))
  for (const value of [undefined, '', 'a'.repeat(63), 'b'.repeat(64), `${key}a`]) assert.ok(!isKey(value, key))
})

it('replaces a key file that is a link or that others may read', { skip: windows && 'no mode bits on Windows' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadley-key-'))
  try {
    const first = browserKey(dir, '/sites/a')
    chmodSync(first.file, 0o644)
    const opened = browserKey(dir, '/sites/a')
    assert.notEqual(opened.key, first.key)
    assert.equal(statSync(opened.file).mode & 0o777, 0o600)
    const elsewhere = join(dir, 'elsewhere')
    writeFileSync(elsewhere, `${'c'.repeat(64)}\n`, { mode: 0o600 })
    rmSync(opened.file)
    symlinkSync(elsewhere, opened.file)
    const linked = browserKey(dir, '/sites/a')
    assert.notEqual(linked.key, 'c'.repeat(64))
    assert.ok(lstatSync(linked.file).isFile())
    assert.equal(readFileSync(elsewhere, 'utf8').trim(), 'c'.repeat(64))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
