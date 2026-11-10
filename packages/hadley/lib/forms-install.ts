/**
 * hadley-forms for `hadley dev`, fetched on request from the release of this hadley (`hadley comments install`, or the
 * question `hadley dev` asks): the archive must match the release's SHA256SUMS, only the one program is taken from it,
 * it must name its version when run with -version, and it is kept in hadley's own directory under that version. Only
 * the local service: production installs its own as docs/comments.md says. SHA256SUMS comes from the same place as the
 * archive, so this checks that the download is whole, not who made it.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { FORMS_PROGRAM } from './forms-service.ts'
import { isProgram } from './platform.ts'

const RELEASES = 'https://github.com/mkorun/hadley/releases/download'
// what an archive and its program may be: today about 3 MB packed and 9 MB unpacked
const MAX_ARCHIVE = 20 << 20
const MAX_PROGRAM = 50 << 20
const MAX_SUMS = 64 << 10
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 5 * 60_000
const VERSION_TIMEOUT_MS = 10_000

// the name a program fetched for a version has (programName)
const INSTALLED = /^hadley-forms-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\.exe)?$/

/** Where a release is fetched from; a test gives its own `fetch`, nothing else can change it. */
export interface Source {
  base: string
  fetch: (url: URL, init: RequestInit) => Promise<Response>
}

export const github = (): Source => ({ base: RELEASES, fetch })

/** A failure the user is told in one line, after `hadley-forms: `. */
export class InstallError extends Error {}

/** The directory hadley keeps the programs it fetched in; not on the PATH. */
export function formsHome(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'hadley', 'bin')
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'hadley', 'bin')
}

const programName = (version: string, platform: string) =>
  `${FORMS_PROGRAM}-${version}${platform === 'win32' ? '.exe' : ''}`

/** The program of `version` in `home`, if it is there and can be run. */
export function installedForms(version: string, home: string, platform: string = process.platform) {
  const path = join(home, programName(version, platform))
  return isProgram(path) ? path : undefined
}

/** The versions of the programs in `home`, by the names hadley gives them. */
export function installedVersions(home: string): string[] {
  let names: string[]
  try {
    names = readdirSync(home)
  } catch {
    return []
  }
  return names.flatMap((name) => INSTALLED.exec(name)?.[1] ?? [])
}

/** The system as a release names it (`linux-amd64`), or undefined for one a release has no program for. */
export function releaseSystem(platform: string = process.platform, arch: string = process.arch) {
  const os = ({ linux: 'linux', darwin: 'darwin', win32: 'windows' } as Record<string, string>)[platform]
  const cpu = ({ x64: 'amd64', arm64: 'arm64' } as Record<string, string>)[arch]
  return os && cpu ? `${os}-${cpu}` : undefined
}

/** The archive of a release for a system, as scripts/build-forms.ts names it. */
export const archiveName = (version: string, system: string) =>
  `${FORMS_PROGRAM}-${version}-${system}${system.startsWith('windows-') ? '.zip' : '.tar.gz'}`

/** Whether version a comes before b, by the order of Semantic Versioning (services/launcher/upgrade.go, older). */
export function older(a: string, b: string): boolean {
  const [aCore = '', aPre] = a.split(/-(.*)/s)
  const [bCore = '', bPre] = b.split(/-(.*)/s)
  const order = compareFields(aCore.split('.'), bCore.split('.'))
  if (order !== 0) return order < 0
  if ((aPre === undefined) !== (bPre === undefined)) return aPre !== undefined
  return compareFields((aPre ?? '').split('.'), (bPre ?? '').split('.')) < 0
}

function compareFields(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [a[i]!, b[i]!]
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    const order = xn && yn ? Number(x) - Number(y) : xn ? -1 : yn ? 1 : x < y ? -1 : x > y ? 1 : 0
    if (order !== 0) return order
  }
  return a.length - b.length
}

/**
 * A response of `url`, with the redirects followed by hand: each over https, to the host of the source or to one of
 * GitHub's hosts for release files.
 */
async function request(source: Source, url: string, method: 'GET' | 'HEAD', signal: AbortSignal) {
  const allowed = new URL(source.base).host
  for (let hops = 0; ; hops++) {
    const at = new URL(url)
    if (at.protocol !== 'https:' || (at.host !== allowed && !at.hostname.endsWith('.githubusercontent.com')))
      throw new InstallError(`the release sent the download to ${at.origin}; nothing was installed`)
    let response: Response
    try {
      response = await source.fetch(at, { method, redirect: 'manual', signal, headers: { 'user-agent': 'hadley' } })
    } catch (error) {
      throw new InstallError(`could not reach GitHub (${(error as Error).message})`)
    }
    const next = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && next) {
      await response.body?.cancel()
      if (hops >= MAX_REDIRECTS) throw new InstallError(`${url}: too many redirects; nothing was installed`)
      url = new URL(next, at).href
      continue
    }
    return response
  }
}

/** The body of `url`, refused when it is longer than `limit`. */
async function download(source: Source, url: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const response = await request(source, url, 'GET', signal)
  if (response.status === 404) {
    await response.body?.cancel()
    return new Uint8Array()
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new InstallError(`could not reach GitHub (${url}: ${response.status})`)
  }
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for await (const part of response.body) {
      length += part.length
      if (length > limit) throw new InstallError(`${url} is larger than ${limit >> 20} MB; nothing was installed`)
      parts.push(part)
    }
  } catch (error) {
    if (error instanceof InstallError) throw error
    throw new InstallError(`could not reach GitHub (${(error as Error).message})`)
  }
  return Buffer.concat(parts)
}

/** What is known of a release before anything is fetched but SHA256SUMS: the archive, its checksum and size. */
export interface Offer {
  version: string
  system: string
  url: string
  sum: string
  size: number | undefined
}

/** The archive of `version` for `system` in its release, or an InstallError that says why there is none. */
export async function offer(version: string, system: string, source: Source = github()): Promise<Offer> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const base = `${source.base}/v${version}/`
  const none = new InstallError(`no release v${version} on GitHub for ${system}`)
  const sums = new TextDecoder().decode(await download(source, `${base}SHA256SUMS`, MAX_SUMS, signal))
  const name = archiveName(version, system)
  const line = sums.split('\n').find((l) => l.replace(/\r$/, '').endsWith(`  ${name}`))
  const sum = line?.slice(0, 64)
  if (!sum || !/^[0-9a-f]{64}$/.test(sum)) throw none
  const head = await request(source, base + name, 'HEAD', signal)
  await head.body?.cancel()
  if (head.status === 404) throw none
  const length = Number(head.headers.get('content-length'))
  return { version, system, url: base + name, sum, size: length > 0 ? length : undefined }
}

/** The bytes of `name` in a ustar archive: the one regular file of that name, else an InstallError. */
export function fromTar(tar: Uint8Array, name: string): Uint8Array {
  const text = (at: number, length: number) => {
    const field = tar.subarray(at, at + length)
    const end = field.indexOf(0)
    return new TextDecoder().decode(end < 0 ? field : field.subarray(0, end))
  }
  let found: Uint8Array | undefined
  for (let at = 0; at + 512 <= tar.length;) {
    if (tar.subarray(at, at + 512).every((byte) => byte === 0)) break
    const size = parseInt(text(at + 124, 12).trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > tar.length)
      throw new InstallError('the archive is broken; nothing was installed')
    const prefix = text(at + 345, 155)
    const path = prefix ? `${prefix}/${text(at, 100)}` : text(at, 100)
    const type = String.fromCharCode(tar[at + 156]!)
    if (path === name || path === `./${name}`) {
      if (type !== '0' && type !== '\0')
        throw new InstallError(`${name} in the archive is no file; nothing was installed`)
      if (found) throw new InstallError(`the archive holds ${name} twice; nothing was installed`)
      if (size > MAX_PROGRAM) throw new InstallError(`${name} is larger than 50 MB; nothing was installed`)
      found = tar.subarray(at + 512, at + 512 + size)
    }
    at += 512 + Math.ceil(size / 512) * 512
  }
  if (!found) throw new InstallError(`the archive holds no ${name}; nothing was installed`)
  return found
}

/** The bytes of `name` in a zip archive: the one regular file of that name, else an InstallError. */
export function fromZip(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const broken = () => new InstallError('the archive is broken; nothing was installed')
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--)
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  if (end < 0) throw broken()
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  let found: Uint8Array | undefined
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) throw broken()
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const unixMode = view.getUint32(at + 38, true) >>> 16
    const local = view.getUint32(at + 42, true)
    const path = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength))
    if (path === name) {
      // a Unix mode that is not a regular file (a link, a directory) is refused; Windows' zips carry none
      if (unixMode !== 0 && (unixMode & 0o170000) !== 0o100000)
        throw new InstallError(`${name} in the archive is no file; nothing was installed`)
      if (found) throw new InstallError(`the archive holds ${name} twice; nothing was installed`)
      if (size > MAX_PROGRAM) throw new InstallError(`${name} is larger than 50 MB; nothing was installed`)
      if (local + 30 > zip.length || view.getUint32(local, true) !== 0x04034b50) throw broken()
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = zip.subarray(start, start + packed)
      if (data.length !== packed) throw broken()
      if (method === 0) found = data
      else if (method === 8) {
        try {
          found = inflateRawSync(data, { maxOutputLength: MAX_PROGRAM })
        } catch {
          throw broken()
        }
      } else throw new InstallError(`${name} is packed in a way hadley does not read; nothing was installed`)
      if (found.length !== size) throw broken()
    }
    at += 46 + nameLength + extra + comment
  }
  if (!found) throw new InstallError(`the archive holds no ${name}; nothing was installed`)
  return found
}

export interface Installed {
  path: string
  removed: string[]
}

/**
 * Fetches the archive of `offered`, checks it and puts its program into `home` as `hadley-forms-<version>`; then
 * removes the older versions there, never a newer one (another hadley may run it) and no other file.
 */
export async function install(offered: Offer, home: string, source: Source = github(), platform = process.platform) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const archive = await download(source, offered.url, MAX_ARCHIVE, signal)
  if (createHash('sha256').update(archive).digest('hex') !== offered.sum)
    throw new InstallError('the download does not match SHA256SUMS; nothing was installed')
  const windows = offered.system.startsWith('windows-')
  let program: Uint8Array
  if (windows) program = fromZip(archive, `${FORMS_PROGRAM}.exe`)
  else {
    let tar: Uint8Array
    try {
      tar = gunzipSync(archive, { maxOutputLength: MAX_PROGRAM + (10 << 20) })
    } catch {
      throw new InstallError('the archive is broken or too large; nothing was installed')
    }
    program = fromTar(tar, FORMS_PROGRAM)
  }

  mkdirSync(home, { recursive: true })
  const path = join(home, programName(offered.version, platform))
  // beside its place, so that the move cannot fail halfway; with .exe, which Windows runs a file by
  const temp = join(home, `.${FORMS_PROGRAM}-${randomBytes(6).toString('hex')}${platform === 'win32' ? '.exe' : ''}`)
  try {
    writeFileSync(temp, program, { mode: 0o755 })
    let printed: string
    try {
      printed = execFileSync(temp, ['-version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, stdio: 'pipe' })
    } catch (error) {
      throw new InstallError(`the program of the release does not run (${(error as Error).message.split('\n')[0]})`)
    }
    if (printed.trim() !== `${FORMS_PROGRAM} ${offered.version}`)
      throw new InstallError(
        `the program of the release says it is ${printed.trim() || 'nothing'}; nothing was installed`,
      )
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }

  // a program still running (on Windows) stays; removing only frees space
  const removed = installedVersions(home).filter((version) => {
    if (!older(version, offered.version)) return false
    try {
      rmSync(join(home, programName(version, platform)))
      return true
    } catch {
      return false
    }
  })
  return { path, removed } satisfies Installed
}

/** The size of an archive in the question, as `3.2 MB`. */
export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

/** `home` as the user is told it: under the home directory with `~`, outside Windows. */
export function shown(home: string, platform = process.platform): string {
  const own = homedir()
  return platform !== 'win32' && (home === own || home.startsWith(own + sep)) ? `~${home.slice(own.length)}` : home
}

export const OFF = `comments.enabled is true, but ${FORMS_PROGRAM} is not installed: comments are off. Run \`hadley comments install\` to get it.`
const ASK_TIMEOUT_MS = 60_000

/** A line of an InstallError for the terminal of `hadley dev`, which goes on without comments. */
export const offLine = (error: InstallError) =>
  `${FORMS_PROGRAM}: ${error.message}${error.message.endsWith('nothing was installed') ? ',' : ';'} comments are off`

/** Asks a yes or no in the terminal; no answer within a minute is a no. */
export async function askYes(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await terminal.question(question, { signal: AbortSignal.timeout(ASK_TIMEOUT_MS) })
    return /^y(?:es)?$/i.test(answer.trim())
  } catch {
    process.stdout.write('\n')
    return false
  } finally {
    terminal.close()
  }
}

export interface OnRequest {
  version: string
  /** whether there is a terminal to ask in */
  interactive: boolean
  ask?: (question: string) => Promise<boolean>
  say: (line: string) => void
  warn: (line: string) => void
  home?: string
  source?: Source
  system?: string | undefined
}

/**
 * What `hadley dev` does with comments.enabled and no program of its own: in a terminal, it asks whether to fetch the
 * program of this hadley's release and fetches it on a yes. The program, or undefined when comments are off.
 */
export async function formsOnRequest(options: OnRequest): Promise<string | undefined> {
  const { version, say, warn, ask = askYes, home = formsHome(), source = github() } = options
  const system = 'system' in options ? options.system : releaseSystem()
  if (!options.interactive || !system) {
    warn(OFF)
    return undefined
  }
  try {
    const offered = await offer(version, system, source)
    const other = installedVersions(home).sort((a, b) => (older(a, b) ? 1 : -1))[0]
    const size = offered.size ? ` (${megabytes(offered.size)})` : ''
    const question = [
      other
        ? `${FORMS_PROGRAM} ${other} is installed, but hadley ${version} needs ${version}.`
        : `comments.enabled is true, but ${FORMS_PROGRAM} is not installed.`,
      `Download ${FORMS_PROGRAM} ${version} for ${system} from GitHub${size} and start it? [y/N] `,
    ].join('\n')
    if (!(await ask(question))) {
      warn(OFF)
      return undefined
    }
    const { path, removed } = await install(offered, home, source)
    say(installedLine(version, home, removed))
    return path
  } catch (error) {
    if (!(error instanceof InstallError)) throw error
    warn(offLine(error))
    return undefined
  }
}

const installedLine = (version: string, home: string, removed: string[]) =>
  `${FORMS_PROGRAM} ${version} checked and installed in ${shown(home)}` +
  (removed.length ? ` (removed ${removed.join(', ')})` : '')

/** `hadley comments install`: fetches the program of this hadley's release without asking. The exit status. */
export async function installCommand(options: {
  version: string
  home?: string
  source?: Source
  system?: string | undefined
}): Promise<number> {
  const { version, home = formsHome(), source = github() } = options
  const system = 'system' in options ? options.system : releaseSystem()
  if (installedForms(version, home)) {
    console.log(`${FORMS_PROGRAM} ${version} is already installed in ${shown(home)}`)
    return 0
  }
  if (!system) {
    console.error(`${FORMS_PROGRAM}: a release has no program for ${process.platform}-${process.arch}`)
    return 1
  }
  try {
    const { removed } = await install(await offer(version, system, source), home, source)
    console.log(installedLine(version, home, removed))
    return 0
  } catch (error) {
    if (!(error instanceof InstallError)) throw error
    console.error(`${FORMS_PROGRAM}: ${error.message}`)
    return 1
  }
}
