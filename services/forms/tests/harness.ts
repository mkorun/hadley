/**
 * Runs a comments service for the contract tests (services/forms/CONTRACT.md): the one FORMS_SERVICE names, a `.ts`
 * file run with the current runtime (the production TypeScript service) or an executable (the Go service). Each start
 * gets its own data directory, a free port and test values for every secret; nothing of a real deployment is read.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ADMIN_TOKEN = 'contract-admin-token'
export const HMAC_SECRET = 'contract-hmac-secret'
export const ORIGIN = 'https://site.example'

/** The environment every start gets; a test adds to it or replaces a value. Cheap proof of work keeps tests fast. */
const BASE_ENV = {
  ADMIN_TOKEN,
  HMAC_SECRET,
  CORS_ORIGINS: ORIGIN,
  PBKDF2_COST: '10',
  PBKDF2_KEY_PREFIX: '0',
}

export interface Service {
  url: string
  dataDir: string
  output: () => string
  stop: () => Promise<void>
}

/** The command that runs the service under test; without FORMS_SERVICE the tests stop and say how to set it. */
function command(): string[] {
  const service = process.env.FORMS_SERVICE
  if (!service) throw new Error('FORMS_SERVICE names the service under test: the Go binary (services/forms)')
  const path = resolve(service)
  return path.endsWith('.ts') ? [process.execPath, path] : [path]
}

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => done(port))
    })
    server.on('error', fail)
  })

/**
 * Starts the service with `env` over the base environment (a value `undefined` leaves the variable out) and `flags`;
 * a DATA_DIR in `env` replaces the directory of its own, which is then not removed.
 */
export async function start(env: Record<string, string | undefined> = {}, flags: string[] = []): Promise<Service> {
  const own = env.DATA_DIR === undefined
  const dataDir = env.DATA_DIR ?? mkdtempSync(join(tmpdir(), 'hadley-forms-contract-'))
  const port = await freePort()
  const [program, ...args] = command()
  const merged: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
  for (const [key, value] of Object.entries({ ...BASE_ENV, DATA_DIR: dataDir, PORT: String(port), ...env }))
    if (value !== undefined) merged[key] = value
  const child: ChildProcess = spawn(program!, [...args, ...flags], { env: merged, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout!.on('data', (chunk) => (output += chunk))
  child.stderr!.on('data', (chunk) => (output += chunk))
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  const url = `http://127.0.0.1:${port}`
  const stop = async () => {
    if (child.exitCode === null) child.kill('SIGTERM')
    await Promise.race([exited, new Promise((wait) => setTimeout(wait, 5_000))])
    if (child.exitCode === null) child.kill('SIGKILL')
    if (own) rmSync(dataDir, { recursive: true, force: true })
  }
  // ready when any HTTP response comes, from a path no route has (it is neither rate-limited nor authenticated)
  const deadline = Date.now() + 10_000
  for (;;) {
    if (child.exitCode !== null) {
      await stop()
      throw new Error(`the service exited with ${child.exitCode} before it was ready:\n${output}`)
    }
    const ready = await fetch(`${url}/contract-probe`, { signal: AbortSignal.timeout(1_000) }).then(
      () => true,
      () => false,
    )
    if (ready) break
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`the service did not answer within 10 seconds:\n${output}`)
    }
    await new Promise((wait) => setTimeout(wait, 100))
  }
  return { url, dataDir, output: () => output, stop }
}

/**
 * Runs the service with `env` and `flags` until it exits by itself (a configuration it refuses, `-version`); its exit
 * code and output.
 */
export async function startFailing(
  env: Record<string, string | undefined>,
  flags: string[] = [],
): Promise<{ code: number; output: string }> {
  const [program, ...args] = command()
  const merged: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...env })) if (value !== undefined) merged[key] = value
  const child = spawn(program!, [...args, ...flags], {
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const code = await new Promise<number>((done) => child.once('exit', (code) => done(code ?? -1)))
  return { code, output }
}

export interface Challenge {
  parameters: {
    algorithm: string
    cost: number
    expiresAt: number
    keyLength: number
    keyPrefix: string
    nonce: string
    salt: string
  }
  signature: string
}

/** The signature a challenge must carry (C5): HMAC-SHA-256 of its parameters as compact JSON with sorted keys. */
export function signature(parameters: Record<string, unknown>, secret = HMAC_SECRET): string {
  const sorted = Object.fromEntries(
    Object.keys(parameters)
      .sort()
      .map((key) => [key, parameters[key]]),
  )
  return createHmac('sha256', secret).update(JSON.stringify(sorted)).digest('hex')
}

/** A solution of `challenge` (C5): the first counter whose derived key begins with the prefix. */
export function solve(challenge: Challenge): { counter: number; derivedKey: string } {
  const { nonce, salt, cost, keyLength, keyPrefix } = challenge.parameters
  const nonceBytes = Buffer.from(nonce, 'hex')
  for (let counter = 0; ; counter++) {
    const counterBytes = Buffer.alloc(4)
    counterBytes.writeUInt32BE(counter)
    const derivedKey = pbkdf2Sync(
      Buffer.concat([nonceBytes, counterBytes]),
      Buffer.from(salt, 'hex'),
      cost,
      keyLength,
      'sha256',
    ).toString('hex')
    if (derivedKey.startsWith(keyPrefix)) return { counter, derivedKey }
  }
}

let calls = 0
/**
 * A fresh challenge from the token route; `from` is the client address the request claims (X-Forwarded-For), by
 * default one of a new /24 network each time, so that the rate limit (C4) does not count the tests' own requests.
 */
export async function challenge(service: Service, from = `10.${++calls >> 8}.${calls & 255}.1`): Promise<Challenge> {
  const response = await fetch(`${service.url}/api/comment/token`, { headers: { 'X-Forwarded-For': from } })
  if (response.status !== 200) throw new Error(`token: ${response.status} ${await response.text()}`)
  return (await response.json()) as Challenge
}

/** A submission body with a solved challenge; `fields` replaces or adds fields. */
export async function submission(service: Service, fields: Record<string, unknown> = {}) {
  const solved = await challenge(service)
  return {
    altcha: { challenge: solved, solution: solve(solved) },
    article_id: 'first-light',
    language_version: 'en',
    parent_comment_id: null,
    name: 'Nora Example',
    email: 'nora@example.net',
    text: 'Thank you for the clear explanation.',
    notify: true,
    ...fields,
  }
}

/** Posts `body` (JSON unless it is a string) to the submission route. */
export function submit(service: Service, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${service.url}/api/comment/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** A request to the admin route with the admin token, or with `token`. */
export function admin(service: Service, method: 'GET' | 'DELETE', token = ADMIN_TOKEN) {
  return fetch(`${service.url}/admin/comments`, { method, headers: { Authorization: `Bearer ${token}` } })
}
