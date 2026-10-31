import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOgDesign } from '../og.ts'
import { buildOverlay, generateOgImage } from '../generate-og-image.ts'
import sharp from 'sharp'

let dir: string
const on = { og: { enabled: true } }
const content = { de: { claim: 'Ein Claim', origin: 'https://example.test' } }

const theme = (css: string, logo = true) => {
  mkdirSync(join(dir, 'theme', 'assets', 'css'), { recursive: true })
  writeFileSync(join(dir, 'theme', 'assets', 'css', 'style.css'), css)
  if (!logo) return
  mkdirSync(join(dir, 'theme', 'assets', 'images'), { recursive: true })
  writeFileSync(
    join(dir, 'theme', 'assets', 'images', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>',
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-og-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the design of og images', () => {
  it('is off unless config.lima enables it, whatever the site has', async () => {
    assert.equal(await loadOgDesign(dir, {}, content, 'de'), undefined)
    assert.equal(await loadOgDesign(dir, { og: { enabled: 'yes' } }, content, 'de'), undefined)
  })

  it('reads the logo, the colours and the claim of every language', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }')
    const design = await loadOgDesign(
      dir,
      on,
      { ...content, en: { claim: 'A claim', origin: 'https://example.test' } },
      'de',
    )
    assert.equal(design?.background, '#102030')
    assert.equal(design?.accent, '#ABCDEF')
    assert.deepEqual(design?.claims, { de: 'Ein Claim', en: 'A claim' })
    assert.equal(design?.logo.aspect, 2)
    assert.equal(design?.defaultLanguage, 'de')
  })

  // they fell back to teblo.de's colours, a guessed logo ratio and an empty claim
  it('stops the build with everything it lacks named, instead of guessing', async () => {
    theme(':root { --og-background: navy; }', false)
    await assert.rejects(
      loadOgDesign(dir, on, { de: {}, en: { claim: 'A claim' } }, 'de'),
      /need a logo .*, --og-background as #rrggbb .*, --og-accent as #rrggbb .*, a claim for the language de$/,
    )
  })
})

describe('the overlay of an og image', () => {
  const X = `"><x-evil t=1>$&$'</x-evil>`
  const overlay = (title: string) =>
    buildOverlay(title, `C${X}`, 'AAAA', 2, 'image/svg+xml', '', false, '#000000').toString()

  it('writes the title and the tagline as text of the SVG', () => {
    const svg = overlay(`T${X}`)
    assert.doesNotMatch(svg, /<x-evil/)
    assert.match(svg, />T&quot;&gt;&lt;x-evil t=1&gt;\$&amp;\$'&lt;\/x-evil&gt;<\/text>/)
    assert.match(svg, />C&quot;&gt;&lt;x-evil t=1&gt;\$&amp;\$'&lt;\/x-evil&gt;<\/text>/)
  })

  // review 2026-10-23: the overlay's own escaper let a control character through into an SVG librsvg rejects
  it('fails for a title XML cannot hold, with the character named', () => {
    assert.throws(() => overlay('T\u0001'), /XML cannot hold the character U\+0001/)
  })
})

// review 2026-10-26 (performance): the cache compared the page file's mtime, so a change of its text made the image
// anew, which shows the title alone (about 150 ms each time)
describe('the og image of a page', () => {
  it('is taken from the store while its title is the same, and made anew when the title changes', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }')
    const design = (await loadOgDesign(dir, on, content, 'de'))!
    const source = join(dir, 'a.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .png()
      .toFile(source)
    const file = join(dir, 'a.md')
    writeFileSync(file, 'Text.')
    const cache = {}
    const make = (title: string) =>
      generateOgImage(
        { urlPath: '/a/', file, metadata: { title } },
        { rel: 'a.png', source },
        join(dir, 'out', 'og.jpg'),
        join(dir, 'store', 'og.jpg'),
        cache,
        design,
        'de',
      )
    assert.equal((await make('Titel')).result, 'generated')
    writeFileSync(file, 'Anderer Text.')
    assert.equal((await make('Titel')).result, 'cached')
    assert.equal((await make('Neuer Titel')).result, 'generated')
  })

  // review 2026-10-26 (perf): the cache did not know the AI badge, so a build kept an image a build from nothing
  // could not make, and an image of a source put back with its old modification time
  it('is made anew when the AI badge or the source changed, though its modification time is the old one', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }')
    const badge = join(dir, 'theme', 'assets', 'icons', 'ai-badge.svg')
    mkdirSync(join(dir, 'theme', 'assets', 'icons'), { recursive: true })
    writeFileSync(badge, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1140 512"/>')
    const design = (await loadOgDesign(dir, on, content, 'de'))!
    const source = join(dir, 'a.png')
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
      'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>' +
      '</rdf:RDF></x:xmpmeta>'
    const image = (color: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .png()
        .withXmp(xmp)
        .toFile(source)
    // a modification time a reset gives back exactly
    const then = new Date('2026-01-01T00:00:00Z')
    await image('#336699')
    utimesSync(source, then, then)
    const cache = {}
    const make = () =>
      generateOgImage(
        { urlPath: '/a/', file: join(dir, 'a.md'), metadata: { title: 'Titel' } },
        { rel: 'a.png', source },
        join(dir, 'out', 'og.jpg'),
        join(dir, 'store', 'og.jpg'),
        cache,
        design,
        'de',
      )
    assert.deepEqual([(await make()).result, (await make()).result], ['generated', 'cached'])
    rmSync(badge)
    await assert.rejects(make(), /an AI-generated og image needs the badge/)
    // another badge
    writeFileSync(badge, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1140 512"><rect/></svg>')
    assert.equal((await make()).result, 'generated')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await image('#996633')
    utimesSync(source, then, then)
    assert.equal((await make()).result, 'generated')
  })
})
