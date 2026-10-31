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
import { gzipSync } from 'node:zlib'

const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const TEST_TIMEOUT_MS = 10 * 60 * 1000
const TOOL_TIMEOUT_MS = 60 * 1000
const repo = join(import.meta.dirname, '..')
const service = join(repo, 'services', 'forms')

/** The systems a release has a program for. Not Windows: the service needs flock there (lock_other.go). */
export const TARGETS = [
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'darwin', arch: 'arm64' },
] as const

const UNIT = 'hadley-forms@.service'

/** A version as package.json gives it, which goes into the program and the file names as it is. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export const archiveName = (version: string, os: string, arch: string) => `hadley-forms-${version}-${os}-${arch}.tar.gz`

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

export interface Licence {
  name: string
  text: string
}

/** THIRD_PARTY_LICENSES: the licences of the code a program carries besides its own, Go's first. */
export function thirdPartyLicences(licences: Licence[]): string {
  const sections = licences.map(({ name, text }) => `## ${name}\n\n${text.trim()}\n`)
  return `hadley-forms contains code of these projects, under these licences.\n\n${sections.join('\n')}`
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
      `--directory=${dir}`,
      '--',
      ...files,
    ],
    { timeout: TOOL_TIMEOUT_MS },
  )
  return gzipSync(tar, { level: 9 })
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
    maxBuffer: 64 * 1024 * 1024,
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
  const env = { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0', GOFLAGS: '-mod=readonly' }
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
    const go = text('go', ['env', 'GOVERSION'], { timeout: TOOL_TIMEOUT_MS })
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
      const linked = build(version, os, arch, join(dir, 'hadley-forms'))
      writeFileSync(join(dir, 'LICENSE'), ownLicence)
      writeFileSync(join(dir, 'THIRD_PARTY_LICENSES'), thirdPartyLicences([goLicence, ...linked]))
      const files = ['hadley-forms', 'LICENSE', 'THIRD_PARTY_LICENSES']
      // the systemd unit the installation takes (docs/comments.md, "Installing the service")
      if (os === 'linux') {
        writeFileSync(join(dir, UNIT), readFileSync(join(service, 'systemd', UNIT)))
        files.push(UNIT)
      }
      for (const file of files) chmodSync(join(dir, file), file === 'hadley-forms' ? 0o755 : 0o644)
      archives.push({ name: archiveName(version, os, arch), bytes: archive(dir, files, time!) })
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
