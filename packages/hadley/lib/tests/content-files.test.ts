import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { fileRequests, parseDocument, render } from '../../case/index.ts'
import { buildPageFiles, frontMatterFiles, sitePaths } from '../build-files.ts'
import { planTheme } from '../theme-files.ts'
import { Output } from '../output.ts'
import { settle } from '../problems.ts'

// From Markdown to HTML with real files: the renderer names them, build-files builds them, the renderer writes them.

let dir: string
let bundle: string
const configs = { default: { widths: [4], formats: ['webp'], sizes: '100vw', quality: 80 } }

const png = (path: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toFile(path)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-content-files-test-'))
  bundle = join(dir, 'content', '[b]')
  mkdirSync(join(bundle, 'sub'), { recursive: true })
  mkdirSync(join(dir, 'theme', 'assets'), { recursive: true })
  await png(join(bundle, 'a.png'))
  await png(join(bundle, 'sub', 'c.png'))
  writeFileSync(join(bundle, 'paper.pdf'), 'pdf')
  writeFileSync(join(dir, 'outside.pdf'), 'secret')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Builds and renders `markdown` as the published page `pageFile`, its problems decided as the build decides them
 * (lib/problems.ts): `publish` stops at a fault, a dev build hands its warnings to `onWarn`.
 */
const page = async (
  markdown: string,
  {
    publish = true,
    pageFile = join(bundle, 'page.md'),
    state = 'published' as 'published' | 'draft',
    onWarn = (_msg: string) => {},
  } = {},
) => {
  const output = new Output(join(dir, 'out'))
  const doc = parseDocument(markdown, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
  const requests = fileRequests(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
  const themeFiles = await planTheme(join(dir, 'theme'), false)
  const names = new Map([...themeFiles].map(([path, file]) => [path, file.name]))
  // the site this page is in: itself at /page/, and another page at /andere/
  output.claim('page/index.html', 'page de/page')
  output.claim('andere/index.html', 'page de/andere')
  const files = await (
    await buildPageFiles(
      { file: pageFile },
      requests,
      configs,
      {
        place: (name, what) => output.claim(name, `page: ${what}`),
        urlPath: '/page/',
        store: join(dir, 'store'),
        base: '',
      },
      {},
      undefined,
    )
  ).written
  const paths = sitePaths(requests, (rel) => output.writesFile(rel), names)
  const failures = [...files.failures, ...paths.failures]
  const problems = failures.map(({ message }) => ({ page: { file: pageFile, state }, message }))
  for (const warning of settle(problems, publish)) onWarn(warning)
  const built = new Map([...files.files, ...paths.files])
  return render(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de', files: built }).html
}

describe('files the content names', () => {
  it('builds a bundle image and writes it as a figure with the attributes of its <m>', async () => {
    const html = await page('<m lang=fr data-credit=me>![x](a.png "Titel")</m>\n')
    assert.equal(
      html,
      '<figure lang="fr" data-credit="me">\n<picture>\n  <source type="image/webp" srcset="a-4w.webp 4w" sizes="100vw">' +
        '\n  <img src="a-4w.webp" alt="x" width="8" height="8" loading="lazy" decoding="async">\n</picture>' +
        '\n<figcaption>Titel</figcaption>\n</figure>',
    )
    assert.ok(existsSync(join(dir, 'out', 'a-4w.webp')))
  })

  it('keeps hostile alt, title and data values as text', async () => {
    const html = await page('<m data-credit="\\"><script>$&">![a"><script>x</script>$&](a.png "t\\"><b>")</m>\n')
    assert.doesNotMatch(html, /<script>|<b>/)
    assert.match(html, /data-credit="&quot;&gt;&lt;script&gt;\$&amp;"/)
    assert.match(html, /alt="a&quot;&gt;&lt;script&gt;x&lt;\/script&gt;\$&amp;"/)
    assert.match(html, /<figcaption>t"&gt;&lt;b&gt;<\/figcaption>/)
  })

  // review 2026-10-23: both failed although the files exist
  it('copies a native-size image from a subdirectory and writes its size', async () => {
    const html = await page('<m data-size=native>![x](sub/c.png)</m>\n')
    assert.match(html, /^<img src="sub\/c.png" alt="x" width="8" height="8" data-size="native"/)
    assert.ok(existsSync(join(dir, 'out', 'sub', 'c.png')))
  })

  it('finds a file of a page in a language directory in its bundle', async () => {
    mkdirSync(join(bundle, 'en'))
    await page('[PDF](paper.pdf?download=1)\n', { pageFile: join(bundle, 'en', 'page.md') })
    assert.equal(readFileSync(join(dir, 'out', 'paper.pdf'), 'utf8'), 'pdf')
  })

  // review 2026-10-25: a destination outside the bundle is the site path a browser resolves it to
  it('fails a published page for a file that is missing, outside the bundle or missing in the theme', async () => {
    await assert.rejects(page('![x](missing.png)\n'), /missing\.png does not exist/)
    await assert.rejects(page('[x](missing.pdf#page=2)\n'), /missing\.pdf#page=2 does not exist/)
    await assert.rejects(
      page('[x](../../outside.pdf)\n'),
      /\.\.\/\.\.\/outside\.pdf is neither a page nor a file the site writes/,
    )
    await assert.rejects(page('[x](%2e%2e/%2e%2e/outside.pdf)\n'), /is neither a page nor a file the site writes/)
    await assert.rejects(
      page('![x](/assets/none.png)\n'),
      /\/assets\/none\.png is neither a page nor a file the site writes/,
    )
    assert.ok(
      !existsSync(join(dir, 'out', '..', '..', 'outside.pdf')) || readFileSync(join(dir, 'outside.pdf'), 'utf8'),
    )
  })

  // review 2026-10-23: a file's URL was the destination as written, not the file that was copied
  it('writes the URL of a copied file from its name in the bundle, keeping a query and fragment', async () => {
    writeFileSync(join(bundle, 'a b.pdf'), 'pdf')
    const html = await page('[x](./paper.pdf?download=1#page=2) [y](a%20b.pdf) [z](notes)\n', { publish: false })
    assert.match(html, /<a href="paper\.pdf\?download=1#page=2">x<\/a>/)
    assert.match(html, /<a href="a%20b\.pdf">y<\/a>/)
    assert.match(html, /z<!-- not built: notes does not exist -->/)
    assert.ok(existsSync(join(dir, 'out', 'a b.pdf')))
  })

  it('fails a published page for a theme file or encoded name that does not exist', async () => {
    await assert.rejects(
      page('<m video>[v](/assets/missing.mp3)</m>\n'),
      /\/assets\/missing\.mp3 is neither a page nor/,
    )
    await assert.rejects(page('![x](/assets%2Fmissing.png)\n'), /holds an encoded \/ or \\ in a segment/)
    await assert.rejects(page('[x](missing%2epdf)\n'), /missing%2epdf does not exist/)
  })

  // review 2026-10-24: an image at another site path or at $… was written unchecked, and a theme file was checked by
  // its source (code.ts) instead of what the theme publishes (code.js)
  it('takes a site path of a resource as a file the theme publishes, by its published name', async () => {
    mkdirSync(join(dir, 'theme', 'static'), { recursive: true })
    await png(join(dir, 'theme', 'static', 'icon.png'))
    writeFileSync(join(dir, 'theme', 'assets', 'code.ts'), 'export {}')
    const html = await page('![i](/icon.png)\n\n<m download>[c](/assets/code.js)</m>\n')
    assert.match(html, /<img src="\/icon\.png" alt="i">/)
    assert.match(html, /<a href="\/assets\/code\.js" download>c<\/a>/)
    await assert.rejects(page('[c](/assets/code.ts)\n'), /\/assets\/code\.ts is neither a page nor a file the site/)
    await assert.rejects(page('![x](/missing.png)\n'), /\/missing\.png is neither a page nor a file the site writes/)
    await assert.rejects(page('![x]($missing)\n'), /\$missing does not exist/)
  })

  // review 2026-10-24 (Fable): a site path a link named was written as it stood, whatever it named
  it('links a site path to a page or a file the site writes, a theme file by its final name', async () => {
    writeFileSync(join(dir, 'theme', 'assets', 'code.ts'), 'export {}')
    const html = await page('[a](/andere/#teil) [b](/page/?x=1) [c](/assets/code.js) [d](/a-4w.webp)\n\n![e](a.png)\n')
    assert.match(
      html,
      /<a href="\/andere\/#teil">a<\/a> <a href="\/page\/\?x=1">b<\/a> <a href="\/assets\/code\.js">c<\/a>/,
    )
    await assert.rejects(page('[x](/andere)\n'), /\/andere is a page, whose path ends in \/$/)
    await assert.rejects(page('[x](/fehlt/)\n'), /\/fehlt\/ is neither a page nor a file the site writes$/)
    await assert.rejects(page('[x](/%zz)\n'), /\/%zz is not a valid URL path$/)
    const warnings: string[] = []
    const html2 = await page('[x](/fehlt/)\n', { publish: false, onWarn: (msg) => warnings.push(msg) })
    assert.match(html2, /x<!-- not built: \/fehlt\/ is neither a page nor a file the site writes -->/)
    assert.equal(warnings.length, 1)
  })

  // review 2026-10-26 (fix round): the draft was a published page
  it('shows a draft the image it could not build, builds the rest, and warns of nothing', async () => {
    const warnings: string[] = []
    const html = await page('![x](missing.png)\n\n![y](a.png)\n', {
      publish: false,
      state: 'draft',
      onWarn: (msg) => warnings.push(msg),
    })
    assert.match(html, /^<!-- not built: missing\.png does not exist -->\n<figure>/)
    assert.deepEqual(warnings, [])
  })

  // a published page in a dev build is shown like a draft, but its missing files are warned about
  it('tells a dev build of a published page what it could not build', async () => {
    const warnings: string[] = []
    await page('![x](missing.png)\n', { publish: false, onWarn: (msg) => warnings.push(msg) })
    assert.deepEqual(warnings, [`${join(bundle, 'page.md')}: missing.png does not exist`])
  })

  // review 2026-10-26: the store kept a derivative by its name, which a.png and a.jpg share, so a build copied the
  // other image's bytes
  it('keeps the derivatives of each image apart in the store, across builds', async () => {
    const color = async (rgb: string, path: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: rgb } }).toFile(path)
    await color('#ff0000', join(bundle, 'a.png'))
    await color('#0000ff', join(bundle, 'a.jpg'))
    const cache = {}
    const reds: boolean[] = []
    const counts: string[] = []
    for (const rel of ['a.png', 'a.jpg', 'a.png', 'a.png']) {
      // the store emptied (`hadley clean`) before the last build
      if (counts.length === 3) rmSync(join(dir, 'store'), { recursive: true, force: true })
      const out = join(dir, 'out')
      rmSync(out, { recursive: true, force: true })
      const output = new Output(out)
      const doc = parseDocument(`![x](${rel})\n`, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const requests = fileRequests(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const place = { place: (name: string, what: string) => output.claim(name, `page: ${what}`), urlPath: '/page/' }
      const { images } = await (
        await buildPageFiles(
          { file: join(bundle, 'page.md') },
          requests,
          configs,
          { ...place, store: join(dir, 'store'), base: '' },
          cache,
          undefined,
        )
      ).written
      // the bytes, not the path, which sharp's cache knows from the build before
      const { data } = await sharp(readFileSync(join(out, 'a-4w.webp')))
        .raw()
        .toBuffer({ resolveWithObject: true })
      reds.push(data[0]! > 128)
      counts.push(`${images.built} new, ${images.cached} cached`)
    }
    assert.deepEqual(reds, [true, false, true, true])
    // review 2026-10-26: the log counted the entries of the cache, so an image made again was not new
    assert.deepEqual(counts, ['1 new, 0 cached', '1 new, 0 cached', '0 new, 1 cached', '1 new, 0 cached'])
  })

  // review 2026-10-26 (perf): a cached image claimed its names up to the first conflict, one made anew all of them
  it('claims the same names and fails the same way whether an image is cached or made', async () => {
    const wide = { default: { widths: [2, 4, 6], formats: ['webp'], sizes: '100vw', quality: 80 } }
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .png()
      .toFile(join(bundle, 'a.png'))
    writeFileSync(join(bundle, 'a-2w.webp'), 'bundle')
    const cache = {}
    const runs: string[] = []
    // with the image not made yet, then made without the conflict, then with the conflict from the store
    for (const markdown of [
      '[copy](a-2w.webp)\n\n![x](a.png)\n',
      '![x](a.png)\n',
      '[copy](a-2w.webp)\n\n![x](a.png)\n',
    ]) {
      const output = new Output(join(dir, `claims-${runs.length}`))
      const doc = parseDocument(markdown, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const requests = fileRequests(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const { failures } = await (
        await buildPageFiles(
          { file: join(bundle, 'page.md') },
          requests,
          wide,
          {
            place: (name, what) => output.claim(name, `page: ${what}`),
            urlPath: '/page/',
            store: join(dir, 'store'),
            base: '',
          },
          cache,
          undefined,
        )
      ).written
      runs.push(`${output.list().join(' ')} | ${failures.map((failure) => failure.message).join(' ')}`)
    }
    assert.equal(runs[0], runs[2])
    assert.match(runs[2]!, /^a-2w\.webp \| a\.png could not be built: a-2w\.webp is written by both/)
  })

  // review 2026-10-26 (perf): the image cache knew a source by its modification time, which a copy can put back
  it('makes an image anew from other bytes put back with the old modification time', async () => {
    const then = new Date('2026-01-01T00:00:00Z')
    const cache = {}
    const reds: boolean[] = []
    for (const [i, rgb] of ['#ff0000', '#0000ff'].entries()) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await sharp({ create: { width: 8, height: 8, channels: 3, background: rgb } })
        .png()
        .toFile(join(bundle, 'a.png'))
      utimesSync(join(bundle, 'a.png'), then, then)
      const out = join(dir, `back-${i}`)
      const output = new Output(out)
      const doc = parseDocument('![x](a.png)\n', { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const requests = fileRequests(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      await (
        await buildPageFiles(
          { file: join(bundle, 'page.md') },
          requests,
          configs,
          {
            place: (name, what) => output.claim(name, `page: ${what}`),
            urlPath: '/page/',
            store: join(dir, 'store'),
            base: '',
          },
          cache,
          undefined,
        )
      ).written
      const { data } = await sharp(readFileSync(join(out, 'a-4w.webp')))
        .raw()
        .toBuffer({ resolveWithObject: true })
      reds.push(data[0]! > 128)
    }
    assert.deepEqual(reds, [true, false])
  })

  // review 2026-10-26 (performance): sharp kept the file it read, so an image another program put in place of one
  // (an editor, cp) was made from the old pixels in a dev server, which builds in one process: a WebP image, whose
  // loader keeps the file
  it('makes an image from the file that is there now, though one was read from the same path before', async () => {
    const color = async (rgb: string, path: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: rgb } })
        .webp()
        .toFile(path)
    await color('#ff0000', join(dir, 'red.webp'))
    await color('#0000ff', join(dir, 'blue.webp'))
    const cache = {}
    const reds: boolean[] = []
    for (const [i, source] of ['red.webp', 'blue.webp'].entries()) {
      rmSync(join(bundle, 'a.webp'), { force: true })
      writeFileSync(join(bundle, 'a.webp'), readFileSync(join(dir, source)))
      const out = join(dir, `out-${i}`)
      const output = new Output(out)
      const doc = parseDocument('![x](a.webp)\n', { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      const requests = fileRequests(doc, { bundlePath: bundle, urlPath: '/page/', lang: 'de' })
      await (
        await buildPageFiles(
          { file: join(bundle, 'page.md') },
          requests,
          configs,
          {
            place: (name, what) => output.claim(name, `page: ${what}`),
            urlPath: '/page/',
            store: join(dir, 'store'),
            base: '',
          },
          cache,
          undefined,
        )
      ).written
      const { data } = await sharp(readFileSync(join(out, 'a-4w.webp')))
        .raw()
        .toBuffer({ resolveWithObject: true })
      reds.push(data[0]! > 128)
    }
    assert.deepEqual(reds, [true, false])
  })

  // review 2026-10-26: an image sharp cannot read stopped the build, a draft's in a dev build too
  // review 2026-10-26: <rel>.d directories met the files of another image's directory
  it('keeps the store of an image apart from the store of an image named like its directory', async () => {
    mkdirSync(join(bundle, 'a.png.d', 'a-4w.webp'), { recursive: true })
    await png(join(bundle, 'a.png.d', 'a-4w.webp', 'b.png'))
    await page('![x](a.png)\n\n![y](a.png.d/a-4w.webp/b.png)\n')
    await page('![y](a.png.d/a-4w.webp/b.png)\n\n![x](a.png)\n')
  })

  it('takes an image sharp cannot read as one that could not be built', async () => {
    writeFileSync(join(bundle, 'bad.png'), 'not an image')
    await assert.rejects(page('![x](bad.png)\n'), /bad\.png could not be built: /)
    const warnings: string[] = []
    const html = await page('![x](bad.png)\n', { publish: false, onWarn: (msg) => warnings.push(msg) })
    assert.match(html, /^<!-- not built: bad\.png could not be built: /)
    assert.equal(warnings.length, 1)
  })

  it('builds a group whose name is a member of Object with the default config', async () => {
    const html = await page('<m group=__proto__>![x](a.png)</m>\n')
    assert.match(html, /srcset="a-4w\.webp 4w"/)
  })

  // review 2026-10-23: derivatives were named from the undecoded name, without its directory
  it('names a derivative next to its image and writes its URL percent-encoded', async () => {
    await png(join(bundle, 'sub', 'a.png'))
    await png(join(bundle, 'ä.png'))
    await png(join(bundle, 'a b.png'))
    const html = await page('![x](a.png)\n\n![y](sub/a.png)\n\n![z](%C3%A4.png)\n\n![w](a%20b.png)\n')
    for (const name of ['a-4w.webp', 'sub/a-4w.webp', 'ä-4w.webp', 'a b-4w.webp']) {
      assert.ok(existsSync(join(dir, 'out', name)), name)
    }
    assert.match(html, /<img src="a-4w\.webp" alt="x"/)
    assert.match(html, /srcset="sub\/a-4w\.webp 4w"[\s\S]*<img src="sub\/a-4w\.webp" alt="y"/)
    assert.match(html, /srcset="%C3%A4-4w\.webp 4w"[\s\S]*<img src="%C3%A4-4w\.webp" alt="z"/)
    assert.match(html, /srcset="a%20b-4w\.webp 4w"[\s\S]*<img src="a%20b-4w\.webp" alt="w"/)
  })
})

describe('files the front matter names', () => {
  // the files, and the failures they are a page's problems for (lib/problems.ts)
  const named = async (metadata: Record<string, unknown>, publish = true) => {
    const page = { file: join(bundle, 'page.md'), state: 'published' as const }
    const { failures, ...files } = await frontMatterFiles(
      { ...page, urlPath: '/page/', metadata },
      'https://site.example',
    )
    return {
      ...files,
      warnings: settle(
        failures.map(({ message }) => ({ page, message })),
        publish,
      ),
    }
  }

  it('finds the cover in the bundle and keeps an absolute og:image', async () => {
    const files = await named({ cover: './sub/c.png', 'og:image': 'https://example.test/og.png' })
    assert.deepEqual(files, {
      warnings: [],
      cover: { rel: 'sub/c.png', source: join(bundle, 'sub', 'c.png') },
      ogImage: 'https://example.test/og.png',
    })
  })

  // review 2026-10-23: the og:image of the front matter went into the page as written
  it('names any other og:image as a file of the bundle, which buildPageFiles builds or fails', async () => {
    assert.deepEqual(await named({ 'og:image': 'og.png' }), {
      warnings: [],
      ogFile: { destination: 'og.png', rel: 'og.png', suffix: '' },
    })
  })

  it('fails a published page for an og:image of a scheme a resource may not have, or at a site path', async () => {
    await assert.rejects(
      named({ 'og:image': 'javascript:alert(1)' }),
      /neither an http\(s\) URL nor a file of the bundle/,
    )
    await assert.rejects(named({ 'og:image': '/assets/og.png' }), /neither an http\(s\) URL nor a file of the bundle/)
  })

  it('fails a published page for a missing cover or an og:image that is not a text', async () => {
    await assert.rejects(named({ cover: 'missing.png' }), /cover missing\.png does not exist/)
    await assert.rejects(named({ 'og:image': 5 }), /og:image 5 is neither an http\(s\) URL nor a file of the bundle/)
  })

  it('leaves a refused one out of a page a dev build shows, with a warning', async () => {
    const { warnings, ...files } = await named({ cover: 'missing.png', 'og:image': 5 }, false)
    assert.deepEqual(files, {})
    assert.equal(warnings.length, 2)
  })
})
