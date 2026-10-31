import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminTokenFor, archiveDirFor } from '../index.ts'

// Where the moderation CLI finds its admin token and its archive (docs/comments.md).

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-comments-token-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const env = (extra: Record<string, string> = {}) => ({ XDG_CONFIG_HOME: join(dir, 'config'), ...extra })

describe('adminTokenFor', () => {
  it("takes a local service's token from the secrets it made in the site's .hadley/forms/", async () => {
    mkdirSync(join(dir, '.hadley', 'forms'), { recursive: true })
    writeFileSync(join(dir, '.hadley', 'forms', 'dev-secrets.json'), '{"adminToken":"local","hmacSecret":"h"}\n')
    assert.equal(await adminTokenFor(dir, true, 'example.org', env()), 'local')
    await assert.rejects(adminTokenFor(join(dir, 'other'), true, 'example.org', env()), /dev-secrets\.json is missing/)
  })

  it('takes the production token from <user configuration>/comments/<host>.token, which only its owner may read', async () => {
    const file = join(dir, 'config', 'hadley', 'comments', 'example.org.token')
    await assert.rejects(
      adminTokenFor(dir, false, 'example.org', env()),
      /no admin token for example\.org: .*example\.org\.token \(mode 600\)/,
    )
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'prod-token\n', { mode: 0o600 })
    assert.equal(await adminTokenFor(dir, false, 'example.org', env()), 'prod-token')
    chmodSync(file, 0o644)
    await assert.rejects(adminTokenFor(dir, false, 'example.org', env()), /can be read by others \(644\): chmod 600 it/)
  })

  it('prefers HADLEY_COMMENTS_TOKEN', async () => {
    assert.equal(await adminTokenFor(dir, false, 'example.org', env({ HADLEY_COMMENTS_TOKEN: 'from-env' })), 'from-env')
  })
})

describe('archiveDirFor', () => {
  it("is comments.archive, relative to the site, and the local service's own in dev", () => {
    assert.equal(archiveDirFor('/site', '../private/comments', false), '/private/comments')
    assert.equal(archiveDirFor('/site', undefined, true), '/site/.hadley/forms/archive')
    assert.throws(() => archiveDirFor('/site', undefined, false), /config\.lima: comments\.archive is missing/)
  })
})
