import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserKey, cookieValue, isKey } from '../browser-key.ts'

it("keeps a site's key private and the same across restarts, one for each site", () => {
  const dir = mkdtempSync(join(tmpdir(), 'hadley-key-'))
  try {
    const first = browserKey(dir, '/sites/a')
    assert.match(first.key, /^[0-9a-f]{64}$/)
    assert.equal(statSync(first.file).mode & 0o777, 0o600)
    assert.deepEqual(browserKey(dir, '/sites/a'), first)
    const other = browserKey(dir, '/sites/b')
    assert.notEqual(other.key, first.key)
    assert.notEqual(other.cookie, first.cookie)
    // a file that holds no key is replaced, not trusted
    writeFileSync(first.file, 'short\n')
    const replaced = browserKey(dir, '/sites/a')
    assert.match(replaced.key, /^[0-9a-f]{64}$/)
    assert.equal(readFileSync(first.file, 'utf8').trim(), replaced.key)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('reads the key from a Cookie header and compares it whole', () => {
  const key = 'a'.repeat(64)
  assert.equal(cookieValue(`x=1; hadley-chat-0123=${key}; y=2`, 'hadley-chat-0123'), key)
  assert.equal(cookieValue('hadley-chat-0123x=1', 'hadley-chat-0123'), undefined)
  assert.equal(cookieValue(undefined, 'hadley-chat-0123'), undefined)
  assert.ok(isKey(key, key))
  for (const value of [undefined, '', 'a'.repeat(63), 'b'.repeat(64), `${key}a`]) assert.ok(!isKey(value, key))
})
