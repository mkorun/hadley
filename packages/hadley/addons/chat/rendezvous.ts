import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { readableByOthers } from '../../lib/platform.ts'
import { MAX_BYTES, object, origin, parseJson, text } from './protocol.ts'

export interface Rendezvous {
  port: number
  token: string
  site: string
  root: string
  pid: number
}

/** The private directories hadley owns; the system temporary directory itself may be shared. */
export function directories(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA || !isAbsolute(env.LOCALAPPDATA)) throw new Error('chat: LOCALAPPDATA needs an absolute path')
    const base = join(env.LOCALAPPDATA, 'hadley')
    return [base, join(base, 'run'), join(base, 'run', 'chat')]
  }
  if (env.XDG_RUNTIME_DIR !== undefined && !isAbsolute(env.XDG_RUNTIME_DIR))
    throw new Error('chat: XDG_RUNTIME_DIR needs an absolute path')
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('chat: the operating system did not provide a user id')
  // A numeric uid also works for accounts without a passwd entry.
  const base = env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'hadley') : join(tmpdir(), `hadley-${uid}`)
  return [base, join(base, 'chat')]
}

/** Windows has no POSIX ownership or private mode check; LOCALAPPDATA is the user's own directory. */
export function assertPrivate(path: string, directory: boolean, uid = process.getuid?.()): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
    throw new Error(`chat: ${path} is not a regular ${directory ? 'directory' : 'file'}`)
  if (process.platform !== 'win32' && (stat.uid !== uid || readableByOthers(stat.mode)))
    throw new Error(`chat: ${path} must belong to this user and be inaccessible to others`)
}

export function rendezvousDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const paths = directories(env)
  for (const path of paths) {
    try {
      mkdirSync(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    assertPrivate(path, true)
  }
  return paths[paths.length - 1]
}

export function parseRendezvous(value: unknown): Rendezvous {
  const record = object(value, ['port', 'token', 'site', 'root', 'pid'])
  if (!Number.isInteger(record.port) || Number(record.port) < 1 || Number(record.port) > 65535)
    throw new Error('port: expected a port from 1 to 65535')
  if (!Number.isSafeInteger(record.pid) || Number(record.pid) < 1) throw new Error('pid: expected a positive integer')
  const token = text(record.token, 'token')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('token: expected 32 random bytes in hex')
  const root = text(record.root, 'root')
  if (!isAbsolute(root)) throw new Error('root: expected an absolute site directory')
  return { port: Number(record.port), token, site: origin(record.site), root, pid: Number(record.pid) }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    throw error
  }
}

function readRecord(path: string): Rendezvous {
  assertPrivate(path, false)
  if (lstatSync(path).size > MAX_BYTES) throw new Error('rendezvous record too large')
  const source = readFileSync(path, 'utf8')
  return parseRendezvous(parseJson(source, 'rendezvous'))
}

export function readRendezvous(dir: string): Rendezvous[] {
  assertPrivate(dir, true)
  const records: Rendezvous[] = []
  for (const name of readdirSync(dir)) {
    if (!/^[0-9]+\.json$/.test(name)) continue
    const path = join(dir, name)
    try {
      const record = readRecord(path)
      if (name !== `${record.port}.json`) throw new Error('filename and port disagree')
      if (alive(record.pid)) records.push(record)
    } catch (error) {
      // A server can end between readdir and readFile.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(`chat: ${path}: ${error instanceof Error ? error.message : error}`)
    }
  }
  return records
}

export function createRendezvous(port: number, site: string, root: string, dir = rendezvousDirectory()) {
  assertPrivate(dir, true)
  const record = parseRendezvous({ port, site, root, pid: process.pid, token: randomBytes(32).toString('hex') })
  const path = join(dir, `${port}.json`)
  // A leftover file is replaced only after its shape and permissions have been checked.
  try {
    const previous = readRecord(path)
    if (alive(previous.pid)) throw new Error(`chat: ${path} belongs to a running server`)
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  assertPrivate(dir, true)
  const temporary = join(dir, `.${port}-${randomBytes(8).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' })
    // A watcher must never see a partially written JSON record.
    renameSync(temporary, path)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    process.off('exit', close)
    try {
      unlinkSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  process.once('exit', close)
  return { record, close }
}
