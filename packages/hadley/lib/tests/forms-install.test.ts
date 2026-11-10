import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, gzipSync } from 'node:zlib'
import {
  OFF,
  archiveName,
  formsHome,
  formsOnRequest,
  fromTar,
  fromZip,
  install,
  installCommand,
  installedForms,
  installedVersions,
  offer,
  older,
  releaseSystem,
  shown,
  type Source,
} from '../forms-install.ts'

// hadley-forms fetched on request (private/docs/SPEC_hadley-forms-download.md): a release served from memory, so that
// nothing here reaches the network and no setting could send hadley elsewhere.

const windows = process.platform === 'win32'
// the program a test archive holds: a script that names its version, which only a Unix system runs by its name
const runs = { skip: windows ? 'the test program is a shell script' : false }
const BASE = 'https://github.com/mkorun/hadley/releases/download'

let dir: string
let home: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-forms-install-test-'))
  home = join(dir, 'bin')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const script = (version: string) => new TextEncoder().encode(`#!/bin/sh\necho "hadley-forms ${version}"\n`)

interface Entry {
  name: string
  body?: Uint8Array
  type?: string
  link?: string
}

/** A ustar archive of `entries`, written by hand so that it can hold what tar would not write. */
function tar(entries: Entry[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const { name, body = new Uint8Array(), type = '0', link = '' } of entries) {
    const header = new Uint8Array(512)
    const put = (at: number, text: string) => header.set(new TextEncoder().encode(text), at)
    put(0, name)
    put(100, '0000755\0')
    put(108, '0000000\0')
    put(116, '0000000\0')
    put(124, body.length.toString(8).padStart(11, '0') + '\0')
    put(136, '00000000000\0')
    put(148, '        ')
    put(156, type)
    put(157, link)
    put(257, 'ustar\0')
    put(263, '00')
    put(
      148,
      header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
    )
    blocks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  blocks.push(new Uint8Array(1024))
  return Buffer.concat(blocks)
}

/** A zip of `entries`, deflated, with a Unix mode when one is given. */
function zip(entries: { name: string; body: Uint8Array; mode?: number }[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, body, mode = 0 } of entries) {
    const packed = deflateRawSync(body)
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, packed)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface Route {
  status?: number
  body?: Uint8Array
  location?: string
  /** bytes after which the body breaks off */
  breakAt?: number
}

/** A release in memory: the routes by URL, and the URLs asked for. */
function release(routes: Record<string, Route>) {
  const asked: string[] = []
  const source: Source = {
    base: BASE,
    fetch: async (input: URL, init: RequestInit) => {
      const url = String(input)
      asked.push(`${init?.method ?? 'GET'} ${url}`)
      const route = routes[url]
      if (!route) return new Response(null, { status: 404 })
      const headers = new Headers(route.location ? { location: route.location } : {})
      if (route.body) headers.set('content-length', String(route.body.length))
      if (init?.method === 'HEAD') return new Response(null, { status: route.status ?? 200, headers })
      const body = route.body
      if (body && route.breakAt !== undefined) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body.subarray(0, route.breakAt))
            controller.error(new Error('connection reset'))
          },
        })
        return new Response(stream, { status: 200, headers })
      }
      return new Response(body ?? null, { status: route.status ?? 200, headers })
    },
  }
  return { source, asked }
}

/** A release of `version` for linux-amd64 with `archive`, and SHA256SUMS that names `sum` for it. */
function linuxRelease(version: string, archive: Uint8Array, sum = sha(archive), extra: Record<string, Route> = {}) {
  const name = archiveName(version, 'linux-amd64')
  return release({
    [`${BASE}/v${version}/SHA256SUMS`]: { body: new TextEncoder().encode(`${sum}  ${name}\n`) },
    [`${BASE}/v${version}/${name}`]: { body: archive },
    ...extra,
  })
}

const goodArchive = (version: string) =>
  gzipSync(
    tar([
      { name: 'hadley-forms', body: script(version) },
      { name: 'LICENSE', body: script('x') },
    ]),
  )

describe('where and which', () => {
  it('keeps the programs in hadley’s own directory, not on the PATH', () => {
    assert.equal(formsHome({ XDG_DATA_HOME: '/data' }, 'linux'), join('/data', 'hadley', 'bin'))
    assert.equal(
      formsHome({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32'),
      join('C:\\Users\\u\\AppData\\Local', 'hadley', 'bin'),
    )
  })

  it('names the systems a release has, and no other', () => {
    assert.equal(releaseSystem('linux', 'x64'), 'linux-amd64')
    assert.equal(releaseSystem('darwin', 'arm64'), 'darwin-arm64')
    assert.equal(releaseSystem('win32', 'arm64'), 'windows-arm64')
    assert.equal(releaseSystem('freebsd', 'x64'), undefined)
    assert.equal(releaseSystem('linux', 'ia32'), undefined)
    assert.equal(archiveName('0.3.0', 'windows-amd64'), 'hadley-forms-0.3.0-windows-amd64.zip')
    assert.equal(archiveName('0.3.0', 'linux-arm64'), 'hadley-forms-0.3.0-linux-arm64.tar.gz')
  })

  it('orders versions as Semantic Versioning does', () => {
    assert.ok(older('0.3.0', '0.10.0'))
    assert.ok(older('0.3.0-rc.1', '0.3.0'))
    assert.ok(older('0.3.0-rc.2', '0.3.0-rc.10'))
    assert.ok(!older('0.3.0', '0.3.0'))
    assert.ok(!older('1.0.0', '0.9.9'))
  })

  it('finds only the version hadley asks for, by its name', () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'hadley-forms-0.2.0'), '', { mode: 0o755 })
    writeFileSync(join(home, 'notes.txt'), '')
    assert.equal(installedForms('0.3.0', home), undefined)
    assert.deepEqual(installedVersions(home), ['0.2.0'])
    assert.deepEqual(installedVersions(join(dir, 'missing')), [])
  })
})

describe('reading an archive', () => {
  it('takes the one program and nothing else', () => {
    const archive = tar([
      { name: 'LICENSE', body: script('x') },
      { name: 'hadley-forms', body: script('0.3.0') },
    ])
    assert.deepEqual(new Uint8Array(fromTar(archive, 'hadley-forms')), script('0.3.0'))
  })

  it('never takes a link, a second program or a path with ..; it writes nothing of the archive’s names', () => {
    const link = tar([{ name: 'hadley-forms', type: '2', link: '/bin/sh' }])
    assert.throws(
      () => fromTar(link, 'hadley-forms'),
      /hadley-forms in the download is no program but a link or a folder/,
    )
    const twice = tar([
      { name: 'hadley-forms', body: script('a') },
      { name: 'hadley-forms', body: script('b') },
    ])
    assert.throws(() => fromTar(twice, 'hadley-forms'), /the download has hadley-forms twice in it/)
    const outside = tar([{ name: '../hadley-forms', body: script('0.3.0') }])
    assert.throws(() => fromTar(outside, 'hadley-forms'), /the download has no hadley-forms in it/)
    assert.throws(() => fromTar(new Uint8Array(512).fill(55), 'hadley-forms'), /broken/)
  })

  it('reads the zip of Windows the same way', () => {
    const exe = 'hadley-forms.exe'
    const both = zip([
      { name: 'LICENSE', body: script('x') },
      { name: exe, body: script('w') },
    ])
    assert.deepEqual(new Uint8Array(fromZip(both, exe)), script('w'))
    assert.throws(
      () => fromZip(zip([{ name: exe, body: script('w'), mode: 0o120777 }]), exe),
      /is no program but a link/,
    )
    assert.throws(
      () =>
        fromZip(
          zip([
            { name: exe, body: script('a') },
            { name: exe, body: script('b') },
          ]),
          exe,
        ),
      /twice/,
    )
    assert.throws(() => fromZip(zip([{ name: `../${exe}`, body: script('w') }]), exe), /has no hadley-forms\.exe in it/)
    assert.throws(() => fromZip(new Uint8Array(100), exe), /broken/)
  })
})

describe('fetching', () => {
  it('installs the checked program under its version and removes only older ones', runs, async () => {
    mkdirSync(home, { recursive: true })
    for (const name of ['hadley-forms-0.2.0', 'hadley-forms-0.9.0', 'hadley-forms', 'notes.txt'])
      writeFileSync(join(home, name), '', { mode: 0o755 })
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    const offered = await offer('0.3.0', 'linux-amd64', source)
    assert.equal(offered.size, goodArchive('0.3.0').length)
    const { path, removed } = await install(offered, home, source)
    assert.equal(path, join(home, 'hadley-forms-0.3.0'))
    assert.equal(installedForms('0.3.0', home), path)
    assert.deepEqual(removed, ['0.2.0'])
    assert.deepEqual(readdirSync(home).sort(), [
      'hadley-forms',
      'hadley-forms-0.3.0',
      'hadley-forms-0.9.0',
      'notes.txt',
    ])
  })

  it('installs nothing when the archive does not match SHA256SUMS', async () => {
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'), sha(script('other')))
    const offered = await offer('0.3.0', 'linux-amd64', source)
    await assert.rejects(install(offered, home, source), /does not match SHA256SUMS; nothing was installed/)
    assert.equal(existsSync(home), false)
  })

  it('says there is no release when SHA256SUMS does not name the archive, or there is none', async () => {
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    await assert.rejects(offer('0.3.0', 'darwin-arm64', source), /no release v0\.3\.0 on GitHub for darwin-arm64/)
    await assert.rejects(offer('0.4.0', 'linux-amd64', source), /no release v0\.4\.0 on GitHub for linux-amd64/)
  })

  it('leaves no half program when the download breaks off', async () => {
    const archive = goodArchive('0.3.0')
    const name = archiveName('0.3.0', 'linux-amd64')
    const { source } = linuxRelease('0.3.0', archive, sha(archive), {
      [`${BASE}/v0.3.0/${name}`]: { body: archive, breakAt: 100 },
    })
    const offered = await offer('0.3.0', 'linux-amd64', source)
    await assert.rejects(install(offered, home, source), /could not reach GitHub \(connection reset\)/)
    assert.equal(existsSync(home), false)
  })

  it('refuses an archive larger than an archive can be', async () => {
    const big = new Uint8Array(21 << 20)
    const { source } = linuxRelease('0.3.0', big)
    const offered = await offer('0.3.0', 'linux-amd64', source)
    await assert.rejects(install(offered, home, source), /the download is larger than 20 MB; nothing was installed/)
  })

  it('installs nothing that does not name the version it was fetched for', runs, async () => {
    const { source } = linuxRelease('0.3.0', goodArchive('0.2.9'))
    const offered = await offer('0.3.0', 'linux-amd64', source)
    await assert.rejects(
      install(offered, home, source),
      /the downloaded program is hadley-forms 0\.2\.9, not 0\.3\.0; nothing was installed/,
    )
    assert.deepEqual(readdirSync(home), [])
  })

  it('follows a redirect to GitHub’s release files, and no other', async () => {
    const archive = goodArchive('0.3.0')
    const name = archiveName('0.3.0', 'linux-amd64')
    const files = 'https://release-assets.githubusercontent.com/archive'
    const good = linuxRelease('0.3.0', archive, sha(archive), {
      [`${BASE}/v0.3.0/${name}`]: { status: 302, location: files },
      [files]: { body: archive },
    })
    assert.equal((await offer('0.3.0', 'linux-amd64', good.source)).size, archive.length)
    assert.ok(good.asked.includes(`HEAD ${files}`))
    for (const elsewhere of ['https://example.com/archive', 'http://release-assets.githubusercontent.com/archive']) {
      const bad = linuxRelease('0.3.0', archive, sha(archive), {
        [`${BASE}/v0.3.0/${name}`]: { status: 302, location: elsewhere },
      })
      await assert.rejects(
        offer('0.3.0', 'linux-amd64', bad.source),
        /the download was redirected away from GitHub \(https?:\/\/[^)]+\); nothing was installed/,
      )
      assert.ok(!bad.asked.some((line) => line.endsWith(elsewhere)))
    }
  })
})

describe('the question of hadley dev', () => {
  const lines = () => {
    const said: string[] = []
    return { said, say: (l: string) => said.push(`say ${l}`), warn: (l: string) => said.push(`warn ${l}`) }
  }

  it('does not ask without a terminal, and fetches nothing', async () => {
    const { source, asked } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    const out = lines()
    const ask = async () => assert.fail('asked')
    const got = await formsOnRequest({
      version: '0.3.0',
      interactive: false,
      ask,
      ...out,
      home,
      source,
      system: 'linux-amd64',
    })
    assert.equal(got, undefined)
    assert.deepEqual(out.said, [`warn ${OFF}`])
    assert.deepEqual(asked, [])
  })

  it('asks with the size of the release, and after a no installs nothing', async () => {
    const archive = goodArchive('0.3.0')
    const { source } = linuxRelease('0.3.0', archive)
    const out = lines()
    const questions: string[] = []
    const ask = async (q: string) => (questions.push(q), false)
    const got = await formsOnRequest({
      version: '0.3.0',
      interactive: true,
      ask,
      ...out,
      home,
      source,
      system: 'linux-amd64',
    })
    assert.equal(got, undefined)
    const size = `${(archive.length / 1_000_000).toFixed(1)} MB`
    assert.deepEqual(questions, [
      'comments.enabled is true, but hadley-forms is not installed.\n' +
        `Download hadley-forms 0.3.0 for linux-amd64 from GitHub (${size}) and start it? [y/N] `,
    ])
    assert.deepEqual(out.said, [`warn ${OFF}`])
    assert.equal(existsSync(home), false)
  })

  it('after an update names the version it has, and on a yes installs and removes it', runs, async () => {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'hadley-forms-0.2.0'), '', { mode: 0o755 })
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    const out = lines()
    const questions: string[] = []
    const ask = async (q: string) => (questions.push(q), true)
    const got = await formsOnRequest({
      version: '0.3.0',
      interactive: true,
      ask,
      ...out,
      home,
      source,
      system: 'linux-amd64',
    })
    assert.equal(got, join(home, 'hadley-forms-0.3.0'))
    assert.match(questions[0]!, /^hadley-forms 0\.2\.0 is installed, but hadley 0\.3\.0 needs 0\.3\.0\.\n/)
    assert.deepEqual(out.said, [`say hadley-forms 0.3.0 checked and installed in ${shown(home)} (removed 0.2.0)`])
  })

  it('says in one line why comments are off when the release fails', async () => {
    const out = lines()
    const offline: Source = {
      base: BASE,
      fetch: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    }
    await formsOnRequest({ version: '0.3.0', interactive: true, ...out, home, source: offline, system: 'linux-amd64' })
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'), sha(script('other')))
    await formsOnRequest({
      version: '0.3.0',
      interactive: true,
      ask: async () => true,
      ...out,
      home,
      source,
      system: 'linux-amd64',
    })
    await formsOnRequest({ version: '0.3.0', interactive: true, ...out, home, source, system: 'windows-arm64' })
    await formsOnRequest({ version: '0.3.0', interactive: true, ...out, home, source, system: undefined })
    assert.deepEqual(out.said, [
      'warn hadley-forms: could not reach GitHub (getaddrinfo ENOTFOUND); comments are off',
      'warn hadley-forms: the download does not match SHA256SUMS; nothing was installed, comments are off',
      'warn hadley-forms: no release v0.3.0 on GitHub for windows-arm64; comments are off',
      `warn hadley-forms: no release v0.3.0 on GitHub for ${process.platform}-${process.arch}; comments are off`,
    ])
  })
})

describe('hadley comments install', () => {
  it('fetches without asking, and does nothing when the version is there', runs, async () => {
    const { source, asked } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    assert.equal(await installCommand({ version: '0.3.0', home, source, system: 'linux-amd64' }), 0)
    assert.ok(installedForms('0.3.0', home))
    const before = asked.length
    assert.equal(await installCommand({ version: '0.3.0', home, source, system: 'linux-amd64' }), 0)
    assert.equal(asked.length, before)
  })

  it('fails with the reason, and for a system without a release', async () => {
    const { source } = linuxRelease('0.3.0', goodArchive('0.3.0'))
    assert.equal(await installCommand({ version: '0.3.0', home, source, system: 'windows-arm64' }), 1)
    assert.equal(await installCommand({ version: '0.3.0', home, source, system: undefined }), 1)
  })
})
