import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trafficLog } from '../traffic.ts'

it('writes nothing without the log variable and repairs an existing log to private mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'hadley-chat-log-'))
  try {
    const disabled = trafficLog(undefined)
    disabled.write('to-claude', 'ignored')
    disabled.close()
    assert.deepEqual(readdirSync(root), [])
    const file = join(root, 'traffic.jsonl')
    writeFileSync(file, '', { mode: 0o644 })
    const log = trafficLog(file)
    log.token('private-test-token')
    log.write('to-server', { text: 'private-test-token' }, 'http://localhost:8000')
    log.close()
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(readFileSync(file, 'utf8').includes('private-test-token'), false)
    assert.throws(() => trafficLog(''), /HADLEY_CHAT_LOG/)
    assert.throws(() => trafficLog(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
