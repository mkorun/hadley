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
  directories,
  parseRendezvous,
  readRendezvous,
  rendezvousDirectory,
} from '../rendezvous.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-chat-rendezvous-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('creates private directories and files, validates the record and removes it idempotently', () => {
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const created = createRendezvous(8000, 'https://site.example', dir, runtime)
  try {
    assert.deepEqual(readRendezvous(runtime), [created.record])
    assert.deepEqual(parseRendezvous(JSON.parse(readFileSync(join(runtime, '8000.json'), 'utf8'))), created.record)
    if (process.platform !== 'win32') {
      for (const path of directories({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir }))
        assert.equal(statSync(path).mode & 0o777, 0o700)
      assert.equal(statSync(join(runtime, '8000.json')).mode & 0o777, 0o600)
    }
    assert.throws(() => createRendezvous(8000, 'https://site.example', dir, runtime), /running server/)
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

it('skips a dead pid, rejects malformed or shared files, and replaces a stale record', async () => {
  const child = spawn(process.execPath, ['-e', ''], { timeout: 10_000 })
  await once(child, 'exit')
  assert.equal(alive(child.pid!), false)
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const path = join(runtime, '8000.json')
  const record = { port: 8000, token: 'a'.repeat(64), root: dir, site: 'https://site.example', pid: child.pid }
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 })
  assert.deepEqual(readRendezvous(runtime), [])
  const created = createRendezvous(8000, record.site, dir, runtime)
  created.close()
  writeFileSync(path, '{\"token\":\"do-not-repeat-this\"', { mode: 0o600 })
  assert.throws(
    () => readRendezvous(runtime),
    (error: Error) => {
      assert.match(error.message, /rendezvous: invalid JSON/)
      assert.ok(!error.message.includes('do-not-repeat-this'))
      return true
    },
  )
  writeFileSync(path, '{}', { mode: 0o600 })
  assert.throws(() => readRendezvous(runtime), /8000\.json: port/)
  if (process.platform !== 'win32') {
    writeFileSync(path, JSON.stringify(record))
    chmodSync(path, 0o644)
    assert.throws(() => readRendezvous(runtime), /inaccessible to others/)
  }
})

it('removes rendezvous files on normal process exit', async () => {
  const runtime = rendezvousDirectory({ XDG_RUNTIME_DIR: dir, LOCALAPPDATA: dir })
  const module = fileURLToPath(new URL('../rendezvous.ts', import.meta.url))
  const source = `import { createRendezvous } from ${JSON.stringify(module)}; createRendezvous(8000, 'https://site.example', ${JSON.stringify(dir)}, ${JSON.stringify(runtime)})`
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
