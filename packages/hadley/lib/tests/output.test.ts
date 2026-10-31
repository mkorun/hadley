import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Output } from '../output.ts'

describe('Output', () => {
  it('gives each path inside the output directory to one owner', () => {
    const output = new Output('/out')
    assert.equal(output.claim('a/index.html', 'page de/a'), '/out/a/index.html')
    assert.equal(output.claim('a/index.html', 'page de/a'), '/out/a/index.html')
    assert.throws(
      () => output.claim('a/index.html', 'page en/a'),
      /a\/index\.html is written by both page de\/a and page en\/a/,
    )
    assert.throws(() => output.claim('a/./index.html', 'theme: a/index.html'), /written by both/)
  })

  it('refuses two paths that differ only in case, which macOS and Windows write as one', () => {
    const output = new Output('/out')
    output.claim('about/index.html', 'page de/about')
    assert.throws(
      () => output.claim('About/index.html', 'page en/about'),
      /About\/index\.html of page en\/about and about\/index\.html of page de\/about differ only in case/,
    )
    assert.throws(() => output.claim('ABOUT/photo.jpg', 'page de/x: photo.jpg'), /ABOUT of .* and about of .* differ/)
    assert.equal(output.claim('about/photo.jpg', 'page de/about: photo.jpg'), '/out/about/photo.jpg')
  })

  it('refuses two paths that differ only in Unicode normalisation, which macOS writes as one', () => {
    const output = new Output('/out')
    output.claim('\u00e9/index.html', 'page de/nfc')
    assert.throws(() => output.claim('e\u0301/index.html', 'page de/nfd'), /differ only in case/)
  })

  it('refuses a segment in the form of a Windows short name, which may name another file', () => {
    const output = new Output('/out')
    for (const rel of ['PROGRA~1/index.html', 'docs/photo~12.jpg', 'a~1'])
      assert.throws(() => output.claim(rel, 'page de/a'), /Windows short name/, rel)
    for (const rel of ['~/index.html', 'notes~draft/index.html', 'a~b~1x/index.html', 'version-1~2.html'])
      assert.doesNotThrow(() => output.claim(rel, 'page de/a'), rel)
  })

  it('refuses a path with a backslash, a separator on Windows', () => {
    const output = new Output('/out')
    assert.throws(() => output.claim('a\\..\\..\\x.png', 'theme: x.png'), /names a path with a backslash/)
  })

  it('refuses a path outside the output directory, but not a name that starts with two dots', () => {
    const output = new Output('/out')
    assert.throws(() => output.claim('../x.png', 'page de/a: x.png'), /leaves \/out/)
    assert.throws(() => output.claim('a/../../x.png', 'page de/a: x.png'), /leaves \/out/)
    assert.throws(() => output.claim('', 'site'), /leaves \/out/)
    assert.equal(output.claim('a/..ok.pdf', 'page de/a: ..ok.pdf'), '/out/a/..ok.pdf')
  })
})

describe('Output, as a plan', () => {
  it('gives a directory to one owner as a whole', () => {
    const output = new Output('/out')
    output.claim('suche/index.html', 'page de/suche')
    assert.equal(output.claimDirectory('pagefind', 'site: search index'), '/out/pagefind')
    assert.throws(
      () => output.claim('pagefind/index.html', 'page de/pagefind'),
      /pagefind\/index\.html is written by both site: search index and page de\/pagefind/,
    )
    assert.throws(() => output.claimDirectory('suche', 'site: other'), /suche\/ is written by both page de\/suche/)
    assert.equal(output.claim('pagefind/x.js', 'site: search index'), '/out/pagefind/x.js')
  })

  it('refuses a file where a directory must be, and the other way round, whoever claims them', () => {
    const output = new Output('/out')
    output.claim('a/index.html', 'page de/a')
    assert.throws(() => output.claim('a', 'theme: a'), /a is a file of theme: a and a directory of page de\/a/)
    output.claim('b', 'theme: b')
    assert.throws(() => output.claim('b/index.html', 'page de/b'), /b is a file of theme: b and a directory of page/)
    assert.throws(() => output.claimDirectory('b/c', 'site: x'), /b is a file of theme: b and a directory of site: x/)
    assert.throws(() => output.claimDirectory('b', 'site: x'), /b\/? is (written by both|a file of) theme: b/)
  })

  // review 2026-10-25: one owner could claim a path as a file and as a directory, and a directory over a file of
  // another owner when its own file came first
  it('refuses a path claimed as a file and as a directory, and a directory over any file of another owner', () => {
    const output = new Output('/out')
    output.claimDirectory('dir', 'A')
    assert.throws(() => output.claim('dir', 'A'), /dir is a directory of A and a file of A/)
    const other = new Output('/out')
    other.claim('dir/a', 'A')
    other.claim('dir/b', 'B')
    assert.throws(() => other.claimDirectory('dir', 'A'), /dir\/ is written by both B and A/)
  })

  it('lists every claimed file and directory', () => {
    const output = new Output('/out')
    output.claim('b.txt', 'site: b')
    output.claimDirectory('pagefind', 'site: search index')
    output.claim('a/index.html', 'page de/a')
    output.claim('a/index.html', 'page de/a')
    assert.deepEqual(output.list(), ['a/index.html', 'b.txt', 'pagefind/'])
  })
})
