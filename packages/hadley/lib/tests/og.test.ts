import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOgDesign } from '../og.ts'
import { claimLines } from '../generate-og-default.ts'
import { applyColourMatrix, buildOverlay, generateOgImage } from '../generate-og-image.ts'
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
    assert.equal(await loadOgDesign(dir, {}, content, 'de', {}), undefined)
    assert.equal(await loadOgDesign(dir, { og: { enabled: 'yes' } }, content, 'de', {}), undefined)
  })

  it('reads the logo, the colours and the claim of every language', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }')
    const design = await loadOgDesign(
      dir,
      on,
      { ...content, en: { claim: 'A claim', origin: 'https://example.test' } },
      'de',
      {},
    )
    assert.equal(design?.background, '#102030')
    assert.equal(design?.accent, '#ABCDEF')
    assert.equal(design?.tilt, 0)
    assert.deepEqual(design?.claims, { de: 'Ein Claim', en: 'A claim' })
    assert.equal(design?.logo?.aspect, 2)
    assert.equal(design?.defaultLanguage, 'de')
  })

  // 2026-11-05: the starters' themes have no logo, and turning og images on stopped their build
  it('takes the site title where it has no logo', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }', false)
    const design = (await loadOgDesign(dir, on, { de: { claim: 'Ein Claim', title: 'Feder Katze' } }, 'de', {}))!
    assert.equal(design.logo, undefined)
    assert.deepEqual(design.names, { de: 'Feder Katze' })
    const svg = buildOverlay('Ein Titel', 'Ein Claim', { name: 'Feder & Katze' }, '', false, '#102030').toString()
    assert.match(svg, /font-weight="bold"[^>]*>Feder &amp; Katze<\/text>/)
  })

  // they fell back to teblo.de's colours, a guessed logo ratio and an empty claim
  it('stops the build with everything it lacks named, instead of guessing', async () => {
    theme(':root { --og-background: navy; --og-accent: blue; --og-tilt: a bit; }', false)
    await assert.rejects(
      loadOgDesign(dir, on, { de: {}, en: { claim: 'A claim' } }, 'de', {}),
      /need --og-background as #rrggbb .*, --og-accent as #rrggbb .*, or none, --og-tilt as an angle .*, or none, a claim for the language de, a logo .* or a title for the language de, a logo .* or a title for the language en$/,
    )
  })

  // 2026-11-05: the slant and the line under the claim are teblo.de's, and every other site had them too
  it('sets og-default.jpg straight and plain, unless the theme turns or underlines its claim', async () => {
    theme(':root { --og-background: #102030; }')
    const plain = (await loadOgDesign(dir, on, content, 'de', {}))!
    assert.equal(plain.accent, undefined)
    assert.equal(plain.tilt, 0)
    theme(':root { --og-background: #102030; --og-accent: #00b1ed; --og-tilt: -2deg; }')
    const teblo = (await loadOgDesign(dir, on, content, 'de', {}))!
    assert.equal(teblo.accent, '#00b1ed')
    assert.equal(teblo.tilt, -2)
  })
})

describe('the overlay of an og image', () => {
  const X = `"><x-evil t=1>$&$'</x-evil>`
  const overlay = (title: string) =>
    buildOverlay(
      title,
      `C${X}`,
      { logo: { data: 'AAAA', aspect: 2, mime: 'image/svg+xml' } },
      '',
      false,
      '#000000',
    ).toString()

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
// 2026-11-05: mko.run draws a doodle cover on its stage through a colour matrix, and its og image showed the white file
const DOODLE = '-0.042 0 0.042 0 0.957  -0.363 0 0.363 0 0.945  -0.984 0 0.984 0 0.918  0 0 -1.35 1.35 0'

describe('a cover style in an og image', () => {
  it('goes through its matrix as feColorMatrix applies it: white goes, ink turns paper, amber stays', async () => {
    const m = DOODLE.split(/\s+/).map(Number)
    const pixel = async (colour: string) => {
      const out = await applyColourMatrix(
        await sharp({ create: { width: 1, height: 1, channels: 3, background: colour } })
          .png()
          .toBuffer(),
        m,
      )
      return [...(await sharp(out).raw().toBuffer())]
    }
    assert.equal((await pixel('#ffffff'))[3], 0)
    assert.deepEqual(await pixel('#000000'), [244, 241, 234, 255])
    const amber = await pixel('#edb342')
    assert.ok(Math.abs(amber[0]! - 0xed) <= 2 && Math.abs(amber[1]! - 0xb3) <= 2 && Math.abs(amber[2]! - 0x42) <= 2)
    assert.equal(amber[3], 255)
  })
})

describe('the og image of a page', () => {
  // 2026-11-05: a 4:3 photograph lay in the middle with strips at its sides; a page cuts it where its ogPosition says
  it('is filled by an opaque picture, cut where the page says, and holds a transparent one whole', async () => {
    theme(':root { --og-background: #102030; }')
    const design = (await loadOgDesign(dir, on, content, 'de', {}))!
    const source = join(dir, 'a.png')
    const file = join(dir, 'a.md')
    writeFileSync(file, 'Text.')
    const out = join(dir, 'out', 'og.jpg')
    // the colour at the top left corner of the og image made with `metadata`
    const corner = async (metadata: Record<string, unknown>) => {
      await generateOgImage(
        { urlPath: '/a/', file, metadata: { title: 'Titel', ...metadata } },
        { rel: 'a.png', source },
        out,
        join(dir, 'store', 'og.jpg'),
        {},
        design,
        'de',
      )
      return [...(await sharp(out).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())]
    }
    const near = (rgb: number[], to: number[]) => rgb.every((v, i) => Math.abs(v - to[i]!) <= 6)
    // 4:3, red in its top tenth, white below
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } })
      .composite([
        { input: { create: { width: 400, height: 30, channels: 3, background: '#ff0000' } }, top: 0, left: 0 },
      ])
      .png()
      .toFile(source)
    assert.ok(near(await corner({}), [255, 255, 255]))
    assert.ok(near(await corner({ ogPosition: 'top' }), [255, 0, 0]))
    // transparent: on the ground, whole
    await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(source)
    assert.ok(near(await corner({}), [0x10, 0x20, 0x30]))
  })

  // 2026-11-05: a page whose picture may not go out with its link has its title on the ground
  it('has no picture where the page has none for it, only its title on the ground', async () => {
    theme(':root { --og-background: #102030; }')
    const design = (await loadOgDesign(dir, on, content, 'de', {}))!
    const out = join(dir, 'out', 'og.jpg')
    const file = join(dir, 'a.md')
    writeFileSync(file, 'Text.')
    const made = await generateOgImage(
      { urlPath: '/a/', file, metadata: { title: 'Titel' } },
      null,
      out,
      join(dir, 'store', 'og.jpg'),
      {},
      design,
      'de',
    )
    assert.equal(made.result, 'generated')
    assert.equal(made.isAi, false)
    const pixel = [...(await sharp(out).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())]
    assert.ok(pixel.every((v, i) => Math.abs(v - [0x10, 0x20, 0x30][i]!) <= 6))
  })

  it('is taken from the store while its title is the same, and made anew when the title changes', async () => {
    theme(':root { --og-background: #102030; --og-accent: #ABCDEF; }')
    const design = (await loadOgDesign(dir, on, content, 'de', {}))!
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
    const design = (await loadOgDesign(dir, on, content, 'de', {}))!
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

// 2026-11-05: hadley.sh's claim ran over both edges of og-default.jpg, which broke a claim only at " – "
describe('the claim of og-default.jpg', () => {
  it('breaks at an en dash, as it did', () => {
    assert.deepEqual(claimLines('Software, tools, AI – and the thinking behind them'), {
      line1: 'Software, tools, AI',
      line2: '– and the thinking behind them',
      dashed: true,
      size: 48,
    })
  })

  it('stays one line where it fits', () => {
    assert.deepEqual(claimLines('Notes on type, tools and the slow web'), {
      line1: 'Notes on type, tools and the slow web',
      line2: '',
      dashed: false,
      size: 48,
    })
  })

  it('breaks a long one at the space nearest its middle, and sets it smaller only where a line is still too wide', () => {
    const { line1, line2, dashed, size } = claimLines('A static site generator for people who write their own tools')
    assert.deepEqual(
      [line1, line2, dashed, size],
      ['A static site generator for', 'people who write their own tools', false, 48],
    )
    assert.ok(claimLines('x'.repeat(90)).size < 48)
  })
})
