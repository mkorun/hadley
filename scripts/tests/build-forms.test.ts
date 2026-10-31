import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  TARGETS,
  archive,
  archiveName,
  goVersion,
  ldflags,
  outside,
  sha256sums,
  thirdPartyLicences,
} from '../build-forms.ts'

// The release files of the comments service (scripts/build-forms.ts): what goes into the program and the archives,
// and the checksums a download is checked with.

describe('the release of the comments service', () => {
  it('stamps the version into the program, and only a release version', () => {
    assert.equal(ldflags('0.1.0-rc.1'), '-s -w -buildid= -X main.version=0.1.0-rc.1')
    assert.equal(ldflags('1.2.3'), '-s -w -buildid= -X main.version=1.2.3')
    for (const version of ['', '1.2', 'v1.2.3', '1.2.3 -X main.other=x', '1.2.3-'])
      assert.throws(() => ldflags(version), /is no release version/, version)
  })

  it('names an archive by version and system', () => {
    assert.equal(archiveName('0.1.0-rc.1', 'linux', 'arm64'), 'hadley-forms-0.1.0-rc.1-linux-arm64.tar.gz')
  })

  it('builds with the Go version go.mod names', () => {
    assert.equal(goVersion('module m\n\ngo 1.27.3\n\nrequire x v1\n'), 'go1.27.3')
    assert.match(goVersion(readFileSync(join(import.meta.dirname, '../../services/forms/go.mod'), 'utf8')), /^go\d/)
    assert.throws(() => goVersion('module m\n'), /names no Go version/)
  })

  // a program for Windows would only say that the service needs WSL there (services/forms/lock_other.go)
  it('has programs for the systems the service runs on', () => {
    assert.ok(TARGETS.every(({ os }) => os === 'linux' || os === 'darwin'))
  })

  it("lists each licence of the code linked in under the project's name", () => {
    assert.equal(
      thirdPartyLicences([
        { name: 'Go 1.27.3', text: 'Copyright Go\n' },
        { name: 'golang.org/x/text v0.43.0', text: '\nCopyright text\n\n' },
      ]),
      'hadley-forms contains code of these projects, under these licences.\n\n' +
        '## Go 1.27.3\n\nCopyright Go\n\n## golang.org/x/text v0.43.0\n\nCopyright text\n',
    )
  })

  it('writes checksums as sha256sum -c reads them, by name', () => {
    const sum = (text: string) => createHash('sha256').update(text).digest('hex')
    const encode = (text: string) => new TextEncoder().encode(text)
    assert.equal(
      sha256sums([
        { name: 'b.tar.gz', bytes: encode('b') },
        { name: 'a.tar.gz', bytes: encode('a') },
      ]),
      `${sum('a')}  a.tar.gz\n${sum('b')}  b.tar.gz\n`,
    )
  })

  // review 2026-10-30: a directory reached through a link into the checkout counted as outside it
  it('writes only outside the checkout, a link into it counting as in it', () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-build-forms-'))
    try {
      const checkout = join(root, 'checkout')
      mkdirSync(join(checkout, '..dist'), { recursive: true })
      symlinkSync(checkout, join(root, 'link'))
      assert.equal(outside(join(root, 'release'), checkout), true)
      assert.equal(outside(join(root, 'a', 'b'), checkout), true)
      assert.equal(outside(join(checkout, 'release'), checkout), false)
      assert.equal(outside(join(checkout, '..dist', 'release'), checkout), false)
      assert.equal(outside(join(root, 'link', 'release'), checkout), false)
      assert.equal(outside(checkout, checkout), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // build-forms.ts makes the archives with GNU tar, so on Linux; the tar of macOS has no --mtime
  const GNU_TAR = { skip: process.platform !== 'linux' && 'the archives are made with GNU tar, on Linux' }
  it('writes a file linked twice as two files', GNU_TAR, () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-build-forms-'))
    try {
      writeFileSync(join(root, 'a'), 'same')
      linkSync(join(root, 'a'), join(root, 'b'))
      const tar = join(root, 'list.tar')
      writeFileSync(tar, gunzipSync(archive(root, ['a', 'b'], '1800000000')))
      const listing = spawnSync('tar', ['--list', '--verbose', `--file=${tar}`], { encoding: 'utf8', timeout: 10_000 })
      assert.equal(listing.status, 0)
      assert.doesNotMatch(listing.stdout, /link to/)
    } finally {
      rmSync(root, { recursive: true })
    }
  })

  it('makes the same archive of the same files, with their modes, no owner and the given time', GNU_TAR, () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-build-forms-'))
    try {
      const make = (name: string) => {
        const dir = join(root, name)
        mkdirSync(dir)
        writeFileSync(join(dir, 'hadley-forms'), 'program')
        writeFileSync(join(dir, 'LICENSE'), 'licence')
        chmodSync(join(dir, 'hadley-forms'), 0o755)
        chmodSync(join(dir, 'LICENSE'), 0o644)
        return archive(dir, ['hadley-forms', 'LICENSE'], '1800000000')
      }
      const first = make('first')
      assert.deepEqual(make('second'), first)
      const tar = join(root, 'list.tar')
      writeFileSync(tar, gunzipSync(first))
      const listing = spawnSync('tar', ['--list', '--verbose', '--numeric-owner', '--utc', `--file=${tar}`], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      assert.equal(listing.status, 0, listing.stderr)
      assert.deepEqual(
        listing.stdout
          .trim()
          .split('\n')
          .map((line) =>
            line
              .split(/\s+/)
              .filter((_, i) => i !== 2)
              .join(' '),
          ),
        ['-rwxr-xr-x 0/0 2027-01-15 08:00 hadley-forms', '-rw-r--r-- 0/0 2027-01-15 08:00 LICENSE'],
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
