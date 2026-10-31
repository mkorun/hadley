#!/usr/bin/env bun
/**
 * Builds the programs of a release in a new directory outside the checkout (docs/adr/0005-release-program.md): one
 * hadley per system, which needs nothing installed, with SHA256SUMS, THIRD_PARTY_LICENSES and the install.sh of this
 * version. A program is services/launcher with a payload inside: a pinned Bun, Pagefind without its CJK dictionaries,
 * the package scripts/pack.ts builds and its dependencies at the versions of bun.lock, for that system. The version is
 * that of packages/hadley/package.json. Go comes from the PATH, at the version go.mod names:
 *
 *   mise exec go -- bun scripts/build-binary.ts <directory>
 *
 * The same commit gives the same files, as in scripts/build-forms.ts, whose rules it shares: a checkout with changes is
 * refused, and the payloads are made with GNU tar, so on Linux. The program for this machine must print its version.
 *
 * Exit status: 0 built, 1 failed.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { archive, goVersion, ldflags, outside, sha256sums, thirdPartyLicences } from './build-forms.ts'
import { DIST, main as pack } from './pack.ts'

const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const TOOL_TIMEOUT_MS = 60 * 1000
const repo = join(import.meta.dirname, '..')
const launcher = join(repo, 'services', 'launcher')

/** The Bun of the programs, the one `.github/actions/tools` names, as a test checks. */
export const BUN_VERSION = '1.4.0'
/** The Pagefind of the programs, the one bun.lock names, as a test checks: the package talks to this binary. */
export const PAGEFIND_VERSION = '1.5.2'

interface Asset {
  name: string
  sha256: string
}

interface Target {
  os: 'linux' | 'darwin' | 'windows'
  arch: 'amd64' | 'arm64'
  /** The system and processor as npm's optional dependencies name them. */
  npm: { os: string; cpu: string }
  /** The zip of the Bun release. On x64 the baseline builds, which run on every processor. */
  bun: Asset
  /** The tar.gz of the Pagefind release, its static build on Linux. */
  pagefind: Asset
}

/** The systems a release has a program for, with the checksums of the Bun and Pagefind releases. */
export const TARGETS: Target[] = [
  {
    os: 'linux',
    arch: 'amd64',
    npm: { os: 'linux', cpu: 'x64' },
    bun: {
      name: 'bun-linux-x64-baseline',
      sha256: '184fb4595f0d401a217cf7c78c1bc430ba83314dab7a8b94805babbf7fa7097f',
    },
    pagefind: {
      name: 'x86_64-unknown-linux-musl',
      sha256: 'afb824a9e7f64905a934900481cea5be679c03975e527329e0e5e6cc70f5feda',
    },
  },
  {
    os: 'linux',
    arch: 'arm64',
    npm: { os: 'linux', cpu: 'arm64' },
    bun: { name: 'bun-linux-aarch64', sha256: '4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e' },
    pagefind: {
      name: 'aarch64-unknown-linux-musl',
      sha256: 'f50ec608bcbf431cebd84e0efa3a5b041ee63df2ad81f138023e0cfd2f509424',
    },
  },
  {
    os: 'darwin',
    arch: 'amd64',
    npm: { os: 'darwin', cpu: 'x64' },
    bun: {
      name: 'bun-darwin-x64-baseline',
      sha256: 'da9b9f1b4ba766c6f299711f38dfaa98623e1ed9c40896aa53db803c52ec1fa0',
    },
    pagefind: {
      name: 'x86_64-apple-darwin',
      sha256: '26f51b4ba921897142338fb13b836420696e251fe197b1782ea7981de311156d',
    },
  },
  {
    os: 'darwin',
    arch: 'arm64',
    npm: { os: 'darwin', cpu: 'arm64' },
    bun: { name: 'bun-darwin-aarch64', sha256: 'c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381' },
    pagefind: {
      name: 'aarch64-apple-darwin',
      sha256: '7286f394a349bd37677d44a65a20078a02b1747da0b0814d83403bf86be17abe',
    },
  },
  {
    os: 'windows',
    arch: 'amd64',
    npm: { os: 'win32', cpu: 'x64' },
    bun: {
      name: 'bun-windows-x64-baseline',
      sha256: 'b929c54a9badb104a16dedd23aab6152c86793ae653d4e6b13983ffd0c882a66',
    },
    pagefind: {
      name: 'x86_64-pc-windows-msvc',
      sha256: 'fab125d5e8e2d3481ffe7d36dec6e101f54a6581cd51cf5e2e09220d4bc78e9c',
    },
  },
]

const exe = (os: string) => (os === 'windows' ? '.exe' : '')

export const programName = (version: string, os: string, arch: string) => `hadley-${version}-${os}-${arch}${exe(os)}`

/**
 * Whether a program leaves out the package at `name` in node_modules: the command links, the workspace link to hadley
 * itself, which `dist/` replaces, and the builds for musl, as the programs need glibc.
 */
export const leftOut = (name: string) => name === '.bin' || name === '@mkorun/hadley' || name.includes('musl')

/** install.sh with the version and the checksums of a release, by the system each program is for. */
export function installScript(template: string, version: string, checksums: Record<string, string>): string {
  return template.replaceAll('@version@', version).replace(/@sha256:([a-z0-9-]+)@/g, (_, system: string) => {
    const checksum = checksums[system]
    if (!checksum) throw new Error(`install/install.sh names ${system}, which has no program`)
    return checksum
  })
}

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
  return result.stdout.toString().trim()
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function download(url: string, checksum: string, file: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== checksum) throw new Error(`${url}: not the file its checksum names`)
  writeFileSync(file, bytes)
}

/** Bun and Pagefind for `target`, at the root of `tree`, each checked against its checksum. */
async function runtimes(target: Target, tree: string, scratch: string): Promise<void> {
  const zip = join(scratch, 'bun.zip')
  await download(
    `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${target.bun.name}.zip`,
    target.bun.sha256,
    zip,
  )
  run('unzip', ['-q', '-j', zip, `${target.bun.name}/bun${exe(target.os)}`, '-d', tree], { timeout: TOOL_TIMEOUT_MS })
  const asset = `pagefind-v${PAGEFIND_VERSION}-${target.pagefind.name}.tar.gz`
  const tarball = join(scratch, asset)
  await download(
    `https://github.com/Pagefind/pagefind/releases/download/v${PAGEFIND_VERSION}/${asset}`,
    target.pagefind.sha256,
    tarball,
  )
  run('tar', ['--extract', '--gzip', `--file=${tarball}`, `--directory=${tree}`, `pagefind${exe(target.os)}`], {
    timeout: TOOL_TIMEOUT_MS,
  })
}

/** The packages in `modules`, those of a scope by `@scope/name`. */
const packages = (modules: string) =>
  readdirSync(modules).flatMap((name) =>
    name.startsWith('@') ? readdirSync(join(modules, name)).map((inner) => `${name}/${inner}`) : [name],
  )

/** node_modules for `target` from bun.lock, in `app`, without install scripts and without what a program leaves out. */
function dependencies(target: Target, app: string, scratch: string): void {
  const workspace = join(scratch, 'workspace')
  mkdirSync(join(workspace, 'packages', 'hadley'), { recursive: true })
  for (const file of ['package.json', 'bun.lock', join('packages', 'hadley', 'package.json')])
    copyFileSync(join(repo, file), join(workspace, file))
  run(
    process.execPath,
    [
      'install',
      '--frozen-lockfile',
      '--production',
      '--ignore-scripts',
      '--no-progress',
      // a workspace links its packages from a store; a program carries them as plain directories
      '--linker=hoisted',
      `--os=${target.npm.os}`,
      `--cpu=${target.npm.cpu}`,
    ],
    { cwd: workspace, timeout: INSTALL_TIMEOUT_MS },
  )
  const nested = join(workspace, 'packages', 'hadley', 'node_modules')
  if (existsSync(nested)) throw new Error(`bun install left packages in ${nested}, which a program does not carry`)
  const modules = join(workspace, 'node_modules')
  for (const name of packages(modules)) if (leftOut(name)) rmSync(join(modules, name), { recursive: true, force: true })
  // the binary with its CJK dictionaries; a program starts the one at its root (services/launcher/main.go)
  for (const name of packages(modules).filter((name) => name.startsWith('@pagefind/')))
    rmSync(join(modules, name, 'bin'), { recursive: true, force: true })
  renameSync(modules, join(app, 'node_modules'))
}

/** The files below `dir`, by their path in it, in the order of their bytes, each with the mode a program expects. */
function normalised(dir: string, below = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(dir, below)).sort()) {
    // the command links of a package's own dependencies
    if (name === '.bin') continue
    const path = below ? `${below}/${name}` : name
    const stat = lstatSync(join(dir, path))
    if (stat.isSymbolicLink()) throw new Error(`${path} is a symbolic link, which a program does not carry`)
    if (stat.isDirectory()) files.push(...normalised(dir, path))
    else {
      chmodSync(join(dir, path), stat.mode & 0o100 ? 0o755 : 0o644)
      files.push(path)
    }
  }
  return files
}

/** Builds the program of `target` from its payload, and returns its name, bytes and checksum. */
function program(target: Target, version: string, payload: Uint8Array, scratch: string) {
  const source = join(scratch, 'launcher')
  cpSync(launcher, source, { recursive: true })
  writeFileSync(join(source, 'payload.tar.gz'), payload)
  const name = programName(version, target.os, target.arch)
  const output = join(scratch, name)
  run(
    'go',
    [
      'build',
      '-trimpath',
      '-tags=release',
      `-ldflags=${ldflags(version)} -X main.payloadSum=${sha256(payload)}`,
      '-o',
      output,
      '.',
    ],
    {
      cwd: source,
      env: { ...process.env, GOOS: target.os, GOARCH: target.arch, CGO_ENABLED: '0', GOFLAGS: '-mod=readonly' },
      timeout: BUILD_TIMEOUT_MS,
    },
  )
  const bytes = readFileSync(output)
  return { name, bytes, system: `${target.os}-${target.arch}`, checksum: sha256(bytes) }
}

export async function main(args: string[]): Promise<number> {
  if (args.length !== 1) {
    console.error('usage: mise exec go -- bun scripts/build-binary.ts <directory>')
    return 1
  }
  const out = resolve(args[0]!)
  const scratch = mkdtempSync(join(tmpdir(), 'hadley-binary-'))
  try {
    if (!outside(out, repo)) throw new Error(`${out} is in the checkout; name a directory outside it`)
    if (existsSync(out)) throw new Error(`${out} exists; name a new directory`)
    const changes = run('git', ['status', '--porcelain'], { timeout: TOOL_TIMEOUT_MS })
    if (changes) throw new Error(`the checkout has changes; a release is built from a commit:\n${changes}`)
    const version = JSON.parse(readFileSync(join(repo, 'packages', 'hadley', 'package.json'), 'utf8')).version
    const go = run('go', ['env', 'GOVERSION'], { timeout: TOOL_TIMEOUT_MS })
    const wanted = goVersion(readFileSync(join(launcher, 'go.mod'), 'utf8'))
    if (go !== wanted) throw new Error(`Go is ${go}, go.mod names ${wanted}: run it through mise exec go`)
    const [revision, time] = run('git', ['log', '-1', '--format=%H %ct'], { timeout: TOOL_TIMEOUT_MS }).split(' ')
    if (pack() !== 0) throw new Error('scripts/pack.ts failed')

    const licences = thirdPartyLicences(
      [
        { name: `Bun ${BUN_VERSION}`, text: readFileSync(join(launcher, 'licenses', 'bun.txt'), 'utf8') },
        {
          name: `Pagefind ${PAGEFIND_VERSION}`,
          text: readFileSync(join(launcher, 'licenses', 'pagefind.txt'), 'utf8'),
        },
        {
          name: `Go ${go.slice(2)}`,
          text: readFileSync(join(run('go', ['env', 'GOROOT'], { timeout: TOOL_TIMEOUT_MS }), 'LICENSE'), 'utf8'),
        },
      ],
      'hadley',
    )

    const programs: ReturnType<typeof program>[] = []
    for (const target of TARGETS) {
      const dir = join(scratch, `${target.os}-${target.arch}`)
      const tree = join(dir, 'tree')
      const app = join(tree, 'app')
      mkdirSync(dir)
      mkdirSync(tree)
      cpSync(DIST, app, { recursive: true })
      // Bun reads this one instead of a bunfig.toml in the user's site (services/launcher/main.go)
      writeFileSync(join(app, 'bunfig.toml'), '')
      writeFileSync(join(app, 'THIRD_PARTY_LICENSES'), licences)
      await runtimes(target, tree, dir)
      dependencies(target, app, dir)
      programs.push(program(target, version, archive(tree, normalised(tree), time!), dir))
      rmSync(tree, { recursive: true, force: true })
      console.log(`built ${programs.at(-1)!.name}`)
    }

    const [hostOs, hostArch] = run('go', ['env', 'GOHOSTOS', 'GOHOSTARCH'], { timeout: TOOL_TIMEOUT_MS }).split('\n')
    const native = programs.find(({ system }) => system === `${hostOs}-${hostArch}`)
    if (!native) throw new Error(`no program for this machine, ${hostOs}-${hostArch}`)
    const nativeFile = join(scratch, native.name)
    writeFileSync(nativeFile, native.bytes)
    chmodSync(nativeFile, 0o755)
    const printed = run(nativeFile, ['version'], {
      env: { ...process.env, XDG_CACHE_HOME: join(scratch, 'cache') },
      timeout: TOOL_TIMEOUT_MS,
    })
    if (printed !== `hadley ${version}`) throw new Error(`the program printed ${printed}`)

    const install = installScript(
      readFileSync(join(repo, 'install', 'install.sh'), 'utf8'),
      version,
      Object.fromEntries(programs.map(({ system, checksum }) => [system, checksum])),
    )
    mkdirSync(out, { recursive: true })
    for (const { name, bytes } of programs) {
      writeFileSync(join(out, name), bytes)
      chmodSync(join(out, name), 0o755)
    }
    writeFileSync(join(out, 'install.sh'), install)
    writeFileSync(join(out, 'THIRD_PARTY_LICENSES'), licences)
    const named = [...programs, { name: 'install.sh', bytes: new TextEncoder().encode(install) }]
    writeFileSync(join(out, 'SHA256SUMS'), sha256sums(named))
    console.log(`built hadley ${version} from ${revision} with ${go} in ${out}`)
    return 0
  } catch (error) {
    console.error((error as Error).message)
    return 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
