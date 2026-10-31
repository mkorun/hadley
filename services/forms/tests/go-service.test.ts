import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admin, start, startFailing } from './harness.ts'

// What the Go service does beyond the contract (CONTRACT.md, "The Go service"), through its program: skipped for the
// TypeScript service, which has neither.
const goService = !(process.env.FORMS_SERVICE ?? '').endsWith('.ts')

describe('the Go service', { skip: !goService && 'FORMS_SERVICE is the TypeScript service' }, () => {
  it('does not start a second time on the same data directory', async () => {
    const first = await start()
    try {
      const { code, output } = await startFailing({ DATA_DIR: first.dataDir, PORT: '0' })
      assert.notEqual(code, 0)
      assert.match(output, /is in use by another hadley-forms/)
    } finally {
      await first.stop()
    }
  })

  it('with -dev, creates its data directory and keeps the secrets it makes there for the next start', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'hadley-forms-dev-'))
    const dataDir = join(parent, 'forms')
    const env = { DATA_DIR: dataDir, ADMIN_TOKEN: undefined, HMAC_SECRET: undefined }
    try {
      const first = await start(env, ['-dev'])
      const secrets = JSON.parse(readFileSync(join(dataDir, 'dev-secrets.json'), 'utf8'))
      assert.equal(statSync(join(dataDir, 'dev-secrets.json')).mode & 0o777, 0o600)
      assert.equal((await admin(first, 'GET', secrets.adminToken)).status, 200)
      await first.stop()
      const second = await start(env, ['-dev'])
      assert.equal((await admin(second, 'GET', secrets.adminToken)).status, 200)
      await second.stop()
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
  it('with -version, prints its version and exits', async () => {
    const { code, output } = await startFailing({}, ['-version'])
    assert.equal(code, 0)
    assert.match(output, /^hadley-forms \S+\n$/)
  })
})
