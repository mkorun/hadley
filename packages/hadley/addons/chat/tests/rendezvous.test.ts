import assert from 'node:assert/strict'
import { afterEach, beforeEach, it } from 'node:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import {
  alive,
  assertPrivate,
  createRendezvous,
  certificateFingerprint,
  directories,
  parseRendezvous,
  readRendezvous,
  rendezvousDirectory,
} from '../rendezvous.ts'
import { testCertificate } from './certificate.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-chat-rendezvous-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const options = () => ({ port: 8000, site: 'https://site.example', root: dir, origin: 'http://localhost:8000' })
const noError = (_path: string, error: Error) => assert.fail(error.message)

it('creates private directories and files, validates the record and removes it idempotently', () => {
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const created = createRendezvous(options(), runtime)
  try {
    assert.deepEqual(readRendezvous(runtime, noError), [created.record])
    assert.deepEqual(parseRendezvous(JSON.parse(readFileSync(join(runtime, '8000.json'), 'utf8'))), created.record)
    if (process.platform !== 'win32') {
      for (const path of directories({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir }))
        assert.equal(statSync(path).mode & 0o777, 0o700)
      assert.equal(statSync(join(runtime, '8000.json')).mode & 0o777, 0o600)
    }
    assert.throws(() => createRendezvous(options(), runtime), /running server/)
  } finally {
    created.close()
    created.close()
  }
  assert.equal(existsSync(join(runtime, '8000.json')), false)
})

it('refuses shared directories, other owners and symlinks rather than repairing them', () => {
  if (process.platform === 'win32') return
  const base = join(dir, 'hadley')
  mkdirSync(base, { mode: 0o700 })
  chmodSync(base, 0o755)
  assert.throws(() => rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir }), /inaccessible to others/)
  chmodSync(base, 0o700)
  assert.throws(() => assertPrivate(base, true, process.getuid!() + 1), /belong to this user/)
  const chat = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  chmodSync(chat, 0o770)
  assert.throws(() => rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir }), /inaccessible to others/)
  rmSync(chat, { recursive: true })
  symlinkSync(dir, chat)
  assert.throws(() => rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir }), /not a regular directory/)
})

it('skips dead, malformed and shared records, and replaces a stale record', async () => {
  const child = spawn(process.execPath, ['-e', ''], { timeout: 10_000 })
  await once(child, 'exit')
  assert.equal(alive(child.pid!), false)
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const path = join(runtime, '8000.json')
  const record = { ...options(), token: 'a'.repeat(64), pid: child.pid }
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 })
  assert.deepEqual(readRendezvous(runtime, noError), [])
  const created = createRendezvous(options(), runtime)
  created.close()
  const errors: Error[] = []
  const scan = () => readRendezvous(runtime, (_path, error) => errors.push(error))
  writeFileSync(path, '{"token":"do-not-repeat-this"', { mode: 0o600 })
  assert.deepEqual(scan(), [])
  assert.match(errors.pop()!.message, /rendezvous: invalid JSON/)
  writeFileSync(path, '{}', { mode: 0o600 })
  assert.deepEqual(scan(), [])
  assert.match(errors.pop()!.message, /8000\.json: port/)
  if (process.platform !== 'win32') {
    writeFileSync(path, JSON.stringify(record))
    chmodSync(path, 0o644)
    assert.deepEqual(scan(), [])
    assert.match(errors.pop()!.message, /inaccessible to others/)
  }
})

it('removes rendezvous files on normal process exit', async () => {
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const module = fileURLToPath(new URL('../rendezvous.ts', import.meta.url))
  const source = `import { createRendezvous } from ${JSON.stringify(module)}; createRendezvous(${JSON.stringify(options())}, ${JSON.stringify(runtime)})`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { timeout: 10_000, stdio: 'pipe' })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, stderr)
  assert.equal(existsSync(join(runtime, '8000.json')), false)
})

it('chooses the platform runtime paths and refuses relative environment paths', () => {
  assert.deepEqual(directories({ LOCALAPPDATA: dir }, 'win32'), [
    join(dir, 'hadley'),
    join(dir, 'hadley', 'run'),
    join(dir, 'hadley', 'run', 'chat'),
  ])
  assert.throws(() => directories({}, 'win32'), /LOCALAPPDATA/)
  assert.throws(() => directories({ XDG_RUNTIME_DIR: 'relative' }, 'linux'), /XDG_RUNTIME_DIR/)
  const paths = directories({}, 'linux')
  assert.equal(paths[1], join(paths[0], 'chat'))
  assert.match(paths[0], /hadley-/)
})

it('validates the explicit local origin and requires a SHA-256 pin only for HTTPS', () => {
  const base = { ...options(), pid: process.pid, token: 'a'.repeat(64) }
  assert.deepEqual(parseRendezvous(base), base)
  const fingerprint = certificateFingerprint(testCertificate().cert)
  const secure = { ...base, origin: 'https://localhost:8000', fingerprint }
  assert.deepEqual(parseRendezvous(secure), secure)
  for (const origin of [
    undefined,
    null,
    '',
    'http://other.example:8000',
    'http://localhost:8001',
    'ftp://localhost:8000',
    'http://localhost:8000/',
    'http://localhost:8000?x',
    'http://user@localhost:8000',
    'http://localhost:8000#x',
    'http://127.0.0.1:8000',
  ])
    assert.throws(() => parseRendezvous({ ...base, origin }), /origin/)
  for (const fingerprint of [undefined, null, '', 'a'.repeat(63), 'G'.repeat(64), 'A'.repeat(64), 'AA:BB'])
    assert.throws(() => parseRendezvous({ ...secure, fingerprint }), /fingerprint/)
  assert.throws(() => parseRendezvous({ ...base, fingerprint }), /only allowed with https/)
})

it('keeps a good server when another record is bad, too large or later repaired', () => {
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const good = createRendezvous(options(), runtime)
  const path = join(runtime, '8010.json')
  const errors: Error[] = []
  const scan = () => readRendezvous(runtime, (_path, error) => errors.push(error))
  try {
    writeFileSync(path, '{', { mode: 0o600 })
    assert.deepEqual(scan(), [good.record])
    assert.match(errors.pop()!.message, /8010\.json: rendezvous: invalid JSON/)
    writeFileSync(path, 'x'.repeat(1_048_577))
    assert.deepEqual(scan(), [good.record])
    assert.match(errors.pop()!.message, /record too large/)
    const repaired = { ...good.record, port: 8010, origin: 'http://localhost:8010' }
    writeFileSync(path, JSON.stringify(repaired))
    assert.deepEqual(
      scan().map((record) => record.port),
      [8000, 8010],
    )
    assert.equal(errors.length, 0)
  } finally {
    good.close()
  }
})
