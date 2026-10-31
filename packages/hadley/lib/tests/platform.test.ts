import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsExactly, isSystemFile, lf, readableByOthers, slashed } from '../platform.ts'

describe('platform', () => {
  it('writes a path the file system gives with / between its segments', () => {
    assert.equal(slashed('templates\\partials\\nav.sort', '\\'), 'templates/partials/nav.sort')
    assert.equal(slashed('templates/partials/nav.sort', '/'), 'templates/partials/nav.sort')
    // on Linux and macOS a backslash is part of a name
    assert.equal(slashed('a\\b', '/'), 'a\\b')
  })

  it('knows the files macOS and Windows leave, and only those', () => {
    for (const name of ['.DS_Store', '._article.chase', 'Thumbs.db', 'thumbs.db', 'desktop.ini'])
      assert.equal(isSystemFile(name), true, name)
    for (const name of ['.well-known', '_index.md', 'DS_Store', 'thumbs.dbx', '.htaccess'])
      assert.equal(isSystemFile(name), false, name)
  })

  it('finds a path below a directory only as it is spelled there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hadley-platform-test-'))
    try {
      mkdirSync(join(dir, 'Bilder'))
      writeFileSync(join(dir, 'Bilder', 'Foto.jpg'), '')
      // without the comparison, only a file system that tells names by their case refuses another spelling
      const caseBlindFs = existsSync(join(dir, 'bilder'))
      for (const blind of caseBlindFs ? [true] : [false, true]) {
        assert.equal(existsExactly(dir, 'Bilder/Foto.jpg', { blind }), true)
        assert.equal(existsExactly(dir, 'Bilder/../Bilder/Foto.jpg', { blind }), true)
        assert.equal(existsExactly(dir, 'bilder/foto.jpg', { blind }), false)
        assert.equal(existsExactly(dir, 'Bilder/Missing.jpg', { blind }), false)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads the line ends of Windows as \\n', () => {
    assert.equal(lf('site:\r\n  en:\r\n'), 'site:\n  en:\n')
    assert.equal(lf('a\rb'), 'a\rb')
  })

  it('reads who may read a file from its mode, except on Windows, which keeps none', () => {
    assert.equal(readableByOthers(0o600, { onWindows: false }), false)
    assert.equal(readableByOthers(0o644, { onWindows: false }), true)
    assert.equal(readableByOthers(0o666, { onWindows: true }), false)
  })
})
