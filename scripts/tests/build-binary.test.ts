import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUN_VERSION, PAGEFIND_VERSION, TARGETS, installScript, leftOut, programName } from '../build-binary.ts'

const repo = join(import.meta.dirname, '..', '..')
const template = readFileSync(join(repo, 'install', 'install.sh'), 'utf8')
const unix = { skip: process.platform === 'win32' }

// The programs of a release (scripts/build-binary.ts) and the script that installs one (install/install.sh).

describe('the programs of a release', () => {
  it('names a program by version and system, on Windows as an .exe', () => {
    assert.equal(programName('0.1.0-rc.2', 'linux', 'arm64'), 'hadley-0.1.0-rc.2-linux-arm64')
    assert.equal(programName('1.0.0', 'windows', 'amd64'), 'hadley-1.0.0-windows-amd64.exe')
  })

  it('carries the Bun the project uses, and the Pagefind the package talks to', () => {
    const tools = readFileSync(join(repo, '.github', 'actions', 'tools', 'action.yml'), 'utf8')
    assert.ok(tools.includes(`bun = "${BUN_VERSION}"`))
    assert.ok(readFileSync(join(repo, 'bun.lock'), 'utf8').includes(`"pagefind@${PAGEFIND_VERSION}"`))
  })

  it('names the version of the package wherever a text says which one to take', () => {
    const { version } = JSON.parse(readFileSync(join(repo, 'packages', 'hadley', 'package.json'), 'utf8'))
    assert.ok(readFileSync(join(repo, 'README.md'), 'utf8').includes(`\`${version}\``))
    assert.ok(readFileSync(join(repo, 'docs', 'comments.md'), 'utf8').includes(`version=${version}\n`))
  })

  it('pins every download by its checksum', () => {
    for (const { bun, pagefind } of TARGETS) {
      assert.match(bun.sha256, /^[0-9a-f]{64}$/)
      assert.match(pagefind.sha256, /^[0-9a-f]{64}$/)
    }
  })

  it('leaves out the command links, the workspace link and the builds for musl', () => {
    for (const name of ['.bin', '@mkorun/hadley', '@img/sharp-linuxmusl-x64', 'lightningcss-linux-x64-musl'])
      assert.ok(leftOut(name), name)
    for (const name of ['sharp', '@img/sharp-linux-x64', '@mkorun/galley', 'lightningcss-linux-x64-gnu'])
      assert.ok(!leftOut(name), name)
  })

  it('refuses an install.sh that names a system without a program', () => {
    assert.throws(() => installScript('@sha256:plan9-amd64@', '1.0.0', {}), /plan9-amd64, which has no program/)
  })
})

describe('install.sh', () => {
  const program = '#!/bin/sh\n# hadley: first start, unpacking\necho "hadley 9.9.9"\n'
  const sum = (text: string) => createHash('sha256').update(text).digest('hex')
  const SYSTEMS = ['linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64']

  /** A home, install.sh for version 9.9.9, and stand-ins for curl and uname that log what they are asked. */
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'hadley-install-'))
    const home = join(root, 'home')
    const stubs = join(root, 'stubs')
    mkdirSync(home)
    mkdirSync(stubs)
    writeFileSync(join(root, 'program'), program)
    writeFileSync(
      join(root, 'install.sh'),
      installScript(template, '9.9.9', Object.fromEntries(SYSTEMS.map((system) => [system, sum(program)]))),
    )
    const stub = (name: string, text: string) => {
      writeFileSync(join(stubs, name), `#!/bin/sh\n${text}\n`)
      chmodSync(join(stubs, name), 0o755)
    }
    stub(
      'curl',
      `while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift ;; https*) url=$1 ;; esac
  shift
done
echo "$url" >> "${join(root, 'urls')}"
cp "${join(root, 'program')}" "$out"`,
    )
    stub('uname', 'if [ "$1" = -s ]; then echo "${FAKE_OS:-Linux}"; else echo "${FAKE_MACHINE:-x86_64}"; fi')
    const run = (env: Record<string, string> = {}, script = join(root, 'install.sh')) =>
      spawnSync('sh', [script], {
        encoding: 'utf8',
        timeout: 20_000,
        env: { HOME: home, PATH: `${stubs}:/usr/bin:/bin`, ...env },
      })
    const installed = join(home, '.local', 'bin', 'hadley')
    const left = () => readdirSync(join(home, '.local', 'bin')).filter((name) => name !== 'hadley')
    const urls = () => readFileSync(join(root, 'urls'), 'utf8').trim()
    return { root, home, stub, run, installed, left, urls }
  }

  it('fills in every place of the template', () => {
    const script = installScript(template, '9.9.9', Object.fromEntries(SYSTEMS.map((system) => [system, 'abc'])))
    assert.ok(!script.includes('@'), 'a place is left')
  })

  it('downloads the program of the version for the system, and installs it', unix, () => {
    const { root, run, installed, left, urls } = setup()
    const result = run({ FAKE_MACHINE: 'aarch64' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /hadley 9\.9\.9/)
    assert.equal(urls(), 'https://github.com/mkorun/hadley/releases/download/v9.9.9/hadley-9.9.9-linux-arm64')
    assert.equal(readFileSync(installed, 'utf8'), program)
    assert.deepEqual(left(), [])
    rmSync(root, { recursive: true })
  })

  it('takes the Apple processor under Rosetta', unix, () => {
    const { root, stub, run, urls } = setup()
    stub('sysctl', 'echo 1')
    assert.equal(run({ FAKE_OS: 'Darwin' }).status, 0)
    assert.match(urls(), /hadley-9\.9\.9-darwin-arm64$/)
    rmSync(root, { recursive: true })
  })

  it('says so when the directory is not on the PATH, and only then', unix, () => {
    const { root, home, run } = setup()
    assert.match(run().stdout, /\.local\/bin is not on your PATH/)
    const onPath = `${join(root, 'stubs')}:${join(home, '.local', 'bin')}:/usr/bin:/bin`
    assert.doesNotMatch(run({ PATH: onPath }).stdout, /not on your PATH/)
    rmSync(root, { recursive: true })
  })

  it('leaves nothing, and the program before it, when the checksum differs', unix, () => {
    const { root, run, installed, left } = setup()
    assert.equal(run().status, 0)
    writeFileSync(join(root, 'program'), 'something else\n')
    const result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /its checksum differs/)
    assert.equal(readFileSync(installed, 'utf8'), program)
    assert.deepEqual(left(), [])
    rmSync(root, { recursive: true })
  })

  it('tells the program by the line it carries', () => {
    const line = /grep -q '([^']+)'/.exec(template)![1]!
    assert.ok(readFileSync(join(repo, 'services', 'launcher', 'main.go'), 'utf8').includes(line))
  })

  it('neither touches nor runs another hadley', unix, () => {
    const { root, run, installed, urls } = setup()
    const mine = `#!/bin/sh\ntouch "${join(root, 'ran')}"\n`
    mkdirSync(join(installed, '..'), { recursive: true })
    writeFileSync(installed, mine)
    chmodSync(installed, 0o755)
    let result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /is not the hadley program/)
    assert.equal(readFileSync(installed, 'utf8'), mine)
    assert.ok(!existsSync(join(root, 'ran')))
    rmSync(installed)
    symlinkSync(join(root, 'program'), installed)
    chmodSync(join(root, 'program'), 0o755)
    result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /is not the hadley program/)
    assert.throws(urls)
    rmSync(root, { recursive: true })
  })

  it('does not wait on a pipe in the place of the program', unix, () => {
    const { root, run, installed } = setup()
    mkdirSync(join(installed, '..'), { recursive: true })
    assert.equal(spawnSync('mkfifo', [installed], { timeout: 5_000 }).status, 0)
    const result = run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /is not the hadley program/)
    rmSync(root, { recursive: true })
  })

  it('stops on a system without a program, and says what to do', unix, () => {
    const { root, stub, run, installed } = setup()
    const failure = (env: Record<string, string>) => {
      const result = run(env)
      assert.equal(result.status, 1)
      return result.stderr
    }
    assert.match(failure({ FAKE_OS: 'MINGW64_NT-10.0' }), /hadley-9\.9\.9-windows-amd64\.exe/)
    assert.match(failure({ FAKE_OS: 'Plan9' }), /no program for Plan9/)
    assert.match(failure({ FAKE_MACHINE: 'riscv64' }), /no program for riscv64/)
    stub('ldd', 'echo "musl libc (x86_64)" >&2')
    assert.match(failure({}), /uses musl/)
    assert.ok(!existsSync(installed))
    rmSync(root, { recursive: true })
  })

  it('needs an absolute home', unix, () => {
    const { root, run } = setup()
    assert.match(run({ HOME: 'relative' }).stderr, /HOME is no absolute path/)
    rmSync(root, { recursive: true })
  })

  it('runs nothing when the download stops before the last line', unix, () => {
    const { root, home, run } = setup()
    const whole = readFileSync(join(root, 'install.sh'), 'utf8')
    const cut = join(root, 'cut.sh')
    writeFileSync(cut, whole.slice(0, whole.lastIndexOf('main')))
    assert.equal(run({}, cut).status, 0)
    assert.deepEqual(readdirSync(home), [])
    rmSync(root, { recursive: true })
  })
})
