#!/usr/bin/env bun
/**
 * Builds the release files of the comments service (services/forms/) in a new directory outside the checkout, for the
 * GitHub release of a version (docs/comments.md, "Installing the service"): an archive per system the service runs on,
 * with the program, hadley's licence and those of the Go code linked into it, on Linux also the systemd unit, and
 * SHA256SUMS over the archives. The version is that of packages/hadley/package.json. Before the archives, the program
 * built for this machine passes the contract tests. Go comes from the PATH, at the version go.mod names:
 *
 *   mise exec go -- bun scripts/build-forms.ts <directory>
 *
 * The same commit gives the same files: the programs carry no paths, the archives no time but the commit's and no
 * owner, and a checkout with changes is refused. The archives are made with GNU tar, so on Linux.
 *
 * Exit status: 0 built, 1 failed.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'

const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const TEST_TIMEOUT_MS = 10 * 60 * 1000
const TOOL_TIMEOUT_MS = 60 * 1000
const repo = join(import.meta.dirname, '..')
const service = join(repo, 'services', 'forms')

/** The systems a release has a program for. */
export const TARGETS = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
  { os: 'windows', arch: 'arm64' },
] as const

const UNIT = 'hadley-forms@.service'

/** A version as package.json gives it, which goes into the program and the file names as it is. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const archiveName = (version: string, os: string, arch: string) =>
  `hadley-forms-${version}-${os}-${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`

/** The linker flags of a release: no symbol table, no build id, and the version for `hadley-forms -version`. */
export function ldflags(version: string): string {
  if (!VERSION.test(version)) throw new Error(`packages/hadley/package.json: version ${version} is no release version`)
  return `-s -w -buildid= -X main.version=${version}`
}

/** The Go version go.mod names (`go 1.27.3`), as `go env GOVERSION` prints it. */
export function goVersion(goMod: string): string {
  const match = /^go (\d+\.\d+(?:\.\d+)?)$/m.exec(goMod)
  if (!match) throw new Error('services/forms/go.mod names no Go version')
  return `go${match[1]}`
}

/**
 * The environment of `go build` for a system: what the builder's own settings could change in a release is fixed, as
 * the oldest processors of each architecture must run it.
 */
export const goEnv = (os: string, arch: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GOOS: os,
  GOARCH: arch,
  CGO_ENABLED: '0',
  GOFLAGS: '-mod=readonly',
  GOAMD64: 'v1',
  GOARM64: 'v8.0',
  GOEXPERIMENT: '',
  GOFIPS140: 'off',
  GOTOOLCHAIN: 'local',
  GOENV: 'off',
})

export interface Licence {
  name: string
  text: string
}

/** THIRD_PARTY_LICENSES: the licences of the code `program` carries besides its own. */
export function thirdPartyLicences(licences: Licence[], program = 'hadley-forms'): string {
  const sections = licences.map(({ name, text }) => `## ${name}\n\n${text.trim()}\n`)
  return `${program} contains code of these projects, under these licences.\n\n${sections.join('\n')}`
}

/** Whether `path`, which need not exist yet, lies outside `checkout`, with the symbolic links on both ways followed. */
export function outside(path: string, checkout: string): boolean {
  let existing = resolve(path)
  const rest: string[] = []
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  const where = relative(realpathSync(checkout), join(realpathSync(existing), ...rest))
  return where === '..' || where.startsWith(`..${sep}`) || isAbsolute(where)
}

/**
 * The tar.gz of `files` in `dir`, in that order, the same bytes for the same files: their modes as they are, no owner,
 * the time `time` (Unix seconds); GNU tar writes it, and zlib no name and no time into the gzip header.
 */
export function archive(dir: string, files: string[], time: string): Uint8Array {
  const tar = run(
    'tar',
    [
      '--create',
      '--file=-',
      '--format=ustar',
      `--mtime=@${time}`,
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      // a file twice stays a file twice: how a package manager links its files is not part of the archive
      '--hard-dereference',
      `--directory=${dir}`,
      '--',
      ...files,
    ],
    { timeout: TOOL_TIMEOUT_MS },
  )
  return gzipSync(tar, { level: 9 })
}

/** A ZIP with deflated files, the given time in UTC (DOS precision: two seconds), no extra fields or comments. */
export function zipArchive(dir: string, files: string[], time: string): Uint8Array {
  const date = new Date(Number(time) * 1000)
  const year = date.getUTCFullYear()
  if (!Number.isFinite(date.getTime()) || year < 1980 || year > 2107)
    throw new Error(`ZIP time ${time} is outside 1980–2107`)
  if (files.length > 0xffff) throw new Error('too many files for ZIP without ZIP64')
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file, 'utf8')
    const data = readFileSync(join(dir, file))
    const compressed = deflateRawSync(data, { level: 9 })
    if (name.length > 0xffff || data.length > 0xffffffff || compressed.length > 0xffffffff)
      throw new Error(`${file} is too large for ZIP without ZIP64`)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed: deflate
    header.writeUInt16LE(0x800, 6) // UTF-8 names
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(dosTime, 10)
    header.writeUInt16LE(dosDate, 12)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4) // made by DOS, no Unix attributes
    header.copy(entry, 6, 4, 30)
    entry.writeUInt32LE(offset, 42)
    local.push(header, name, compressed)
    central.push(entry, name)
    offset += header.length + name.length + compressed.length
    if (offset > 0xffffffff) throw new Error('archive is too large for ZIP without ZIP64')
  }
  const directory = Buffer.concat(central)
  if (offset + directory.length > 0xffffffff) throw new Error('archive is too large for ZIP without ZIP64')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

/** SHA256SUMS in the form `sha256sum -c` reads: a line `<hash>  <name>` per file, by name. */
export const sha256sums = (files: { name: string; bytes: Uint8Array }[]) =>
  [...files]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`)
    .join('')

function run(program: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number }) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? repo,
    env: options.env ?? process.env,
    timeout: options.timeout,
    // the tar of a program's payload (scripts/build-binary.ts) comes through here
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const why = result.error?.message ?? (result.stderr.toString().trim() || `exit status ${result.status}`)
    throw new Error(`${program} ${args.join(' ')}: ${why}`)
  }
  return result.stdout
}

const text = (program: string, args: string[], options: Parameters<typeof run>[2]) =>
  run(program, args, options).toString().trim()

function build(version: string, os: string, arch: string, output: string) {
  const env = goEnv(os, arch)
  run('go', ['build', '-trimpath', `-ldflags=${ldflags(version)}`, '-o', output, './cmd/hadley-forms'], {
    cwd: service,
    env,
    timeout: BUILD_TIMEOUT_MS,
  })
  // the modules linked into the program for this system, with their place in the module cache
  const modules = text(
    'go',
    [
      'list',
      '-deps',
      '-f',
      '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}{{end}}',
      './cmd/hadley-forms',
    ],
    { cwd: service, env, timeout: TOOL_TIMEOUT_MS },
  )
  const linked = [...new Set(modules.split('\n').filter(Boolean))].sort()
  return linked.map((line) => {
    const [path, moduleVersion, dir] = line.split(' ')
    const licence = join(dir!, 'LICENSE')
    if (!existsSync(licence)) throw new Error(`${path} ${moduleVersion}: no LICENSE in ${dir}`)
    return { name: `${path} ${moduleVersion}`, text: readFileSync(licence, 'utf8') }
  })
}

export function main(args: string[]): number {
  if (args.length !== 1) {
    console.error('usage: mise exec go -- bun scripts/build-forms.ts <directory>')
    return 1
  }
  const out = resolve(args[0]!)
  const scratch = mkdtempSync(join(tmpdir(), 'hadley-forms-release-'))
  try {
    if (!outside(out, repo)) throw new Error(`${out} is in the checkout; name a directory outside it`)
    if (existsSync(out)) throw new Error(`${out} exists; name a new directory`)
    const changes = text('git', ['status', '--porcelain'], { timeout: TOOL_TIMEOUT_MS })
    if (changes) throw new Error(`the checkout has changes; a release is built from a commit:\n${changes}`)
    const version = JSON.parse(readFileSync(join(repo, 'packages', 'hadley', 'package.json'), 'utf8')).version
    ldflags(version)
    const go = text('go', ['env', 'GOVERSION'], { cwd: service, timeout: TOOL_TIMEOUT_MS })
    const wanted = goVersion(readFileSync(join(service, 'go.mod'), 'utf8'))
    if (go !== wanted) throw new Error(`Go is ${go}, go.mod names ${wanted}: run it through mise exec go`)
    const commit = text('git', ['log', '-1', '--format=%H %ct'], { timeout: TOOL_TIMEOUT_MS })
    const [revision, time] = commit.split(' ')

    // the program for this machine first, through the contract tests and its -version
    mkdirSync(join(scratch, 'native'))
    const native = join(scratch, 'native', 'hadley-forms')
    const host = text('go', ['env', 'GOHOSTOS', 'GOHOSTARCH'], { timeout: TOOL_TIMEOUT_MS }).split('\n')
    build(version, host[0]!, host[1]!, native)
    const printed = text(native, ['-version'], { timeout: TOOL_TIMEOUT_MS })
    if (printed !== `hadley-forms ${version}`) throw new Error(`hadley-forms -version printed ${printed}`)
    const testTmp = join(scratch, 'tmp')
    mkdirSync(testTmp)
    const tests = spawnSync(process.execPath, ['test', 'services/forms/tests/'], {
      cwd: repo,
      env: { ...process.env, FORMS_SERVICE: native, TMPDIR: testTmp },
      stdio: 'inherit',
      timeout: TEST_TIMEOUT_MS,
    })
    if (tests.status !== 0) throw new Error('the contract tests failed')

    const ownLicence = readFileSync(join(repo, 'LICENSE'))
    const goLicence = {
      name: `Go ${go.slice(2)}`,
      text: readFileSync(join(text('go', ['env', 'GOROOT'], { timeout: TOOL_TIMEOUT_MS }), 'LICENSE'), 'utf8'),
    }
    const archives: { name: string; bytes: Uint8Array }[] = []
    for (const { os, arch } of TARGETS) {
      const dir = join(scratch, `${os}-${arch}`)
      mkdirSync(dir)
      const program = os === 'windows' ? 'hadley-forms.exe' : 'hadley-forms'
      const linked = build(version, os, arch, join(dir, program))
      writeFileSync(join(dir, 'LICENSE'), ownLicence)
      writeFileSync(join(dir, 'THIRD_PARTY_LICENSES'), thirdPartyLicences([goLicence, ...linked]))
      const files = [program, 'LICENSE', 'THIRD_PARTY_LICENSES']
      // the systemd unit the installation takes (docs/comments.md, "Installing the service")
      if (os === 'linux') {
        writeFileSync(join(dir, UNIT), readFileSync(join(service, 'systemd', UNIT)))
        files.push(UNIT)
      }
      for (const file of files) chmodSync(join(dir, file), file === program ? 0o755 : 0o644)
      const pack = os === 'windows' ? zipArchive : archive
      archives.push({ name: archiveName(version, os, arch), bytes: pack(dir, files, time!) })
    }

    mkdirSync(out, { recursive: true })
    for (const { name, bytes } of archives) writeFileSync(join(out, name), bytes)
    writeFileSync(join(out, 'SHA256SUMS'), sha256sums(archives))
    console.log(`built hadley-forms ${version} from ${revision} with ${go} in ${out}:`)
    for (const { name } of archives) console.log(`  ${name}`)
    console.log('  SHA256SUMS')
    return 0
  } catch (error) {
    console.error((error as Error).message)
    return 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
