import { describe, test, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyInto,
  pictureTurn,
  pictureOf,
  resolveConfig,
  replaceJpegXmp,
  replacePngXmp,
  stripAiPromptFromXmp,
  stripLocationFromXmp,
  processImage,
  exifLocated,
  exifRights,
  keptExif,
  publishedCopy,
  publishedXmp,
  extractXmpText,
  aiToolOf,
  buildCover,
  type ImageCache,
  type ImageConfigs,
} from '../images.ts'
import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { crc32 } from 'node:zlib'
import { exifOf, locatedPhoto } from './located-photo.ts'

// Injects XMP as APP1 segment into an existing JPEG buffer (mirrors generate-og-image.ts)
const XMP_NS = Buffer.from('http://ns.adobe.com/xap/1.0/\0')
const injectJpegXmp = (jpegBuf: Buffer, xmpStr: string): Buffer => {
  const xmpBuf = Buffer.from(xmpStr)
  const segBodyLen = XMP_NS.length + xmpBuf.length
  const seg = Buffer.allocUnsafe(4 + segBodyLen)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg.writeUInt16BE(2 + segBodyLen, 2)
  XMP_NS.copy(seg, 4)
  xmpBuf.copy(seg, 4 + XMP_NS.length)
  return Buffer.concat([jpegBuf.subarray(0, 2), seg, jpegBuf.subarray(2)])
}

// Injects XMP as iTXt chunk into an existing PNG buffer (before IDAT, like exiftool does)
const injectPngXmp = (pngBuf: Buffer, xmpStr: string): Buffer => {
  const ITXT = Buffer.from('iTXt')
  const IDAT = Buffer.from('IDAT')
  const PREFIX = Buffer.from('XML:com.adobe.xmp\0\0\0\0\0')
  const data = Buffer.concat([PREFIX, Buffer.from(xmpStr)])
  const lenBuf = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcVal = crc32(Buffer.concat([ITXT, data]), 0) >>> 0
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crcVal, 0)
  const chunk = Buffer.concat([lenBuf, ITXT, data, crcBuf])
  // Find first IDAT chunk and insert before it
  let off = 8
  while (off + 8 <= pngBuf.length) {
    if (pngBuf.subarray(off + 4, off + 8).equals(IDAT))
      return Buffer.concat([pngBuf.subarray(0, off), chunk, pngBuf.subarray(off)])
    off += 12 + pngBuf.readUInt32BE(off)
  }
  // Fallback: insert before IEND
  return Buffer.concat([pngBuf.subarray(0, pngBuf.length - 12), chunk, pngBuf.subarray(pngBuf.length - 12)])
}

const AI_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:iptcExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:mko="mko">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="">
      <iptcExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</iptcExt:DigitalSourceType>
      <mko:aiPrompt>secret prompt text that must not appear in derivatives</mko:aiPrompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`

describe('pictureOf', () => {
  test('percent-encodes a list cover’s page path in src and srcset (review 3.4)', () => {
    const urlPath = '/a,b;+[x]{y}^`/über/'
    const encoded = urlPath.split('/').map(encodeURIComponent).join('/')
    const picture = pictureOf(
      'pic.png',
      { naturalWidth: 8, naturalHeight: 8, validWidths: [4] },
      { widths: [4], formats: ['webp'], sizes: '100vw', quality: 80 },
      urlPath,
    )
    assert.equal(picture.src, `${encoded}pic-4w.webp`)
    assert.equal(picture.sources[0]!.srcset, `${encoded}pic-4w.webp 4w`)
  })
})

describe('stripAiPromptFromXmp — namespace-agnostic (independent of the aiprov config)', () => {
  test('removes aiPrompt under an entirely different, unknown namespace', () => {
    const xmp = Buffer.from(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:otherTool="urn:otherTool:1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="">
      <otherTool:aiTool>SomeOtherApp</otherTool:aiTool>
      <otherTool:aiPrompt>secret prompt from a tool hadley has never heard of</otherTool:aiPrompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`,
    )
    const cleaned = stripAiPromptFromXmp(xmp).toString('utf-8')
    assert.ok(!cleaned.includes('aiPrompt'))
    assert.ok(cleaned.includes('otherTool:aiTool')) // andere Properties desselben Namespace bleiben erhalten
  })

  test('entfernt aiPrompt gleichzeitig unter mehreren unterschiedlichen Namespaces', () => {
    const xmp = Buffer.from(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:mko="mko" xmlns:otherTool="urn:otherTool:1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="">
      <mko:aiPrompt>prompt one</mko:aiPrompt>
      <otherTool:aiPrompt>prompt two</otherTool:aiPrompt>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`,
    )
    const cleaned = stripAiPromptFromXmp(xmp).toString('utf-8')
    assert.ok(!cleaned.includes('prompt one'))
    assert.ok(!cleaned.includes('prompt two'))
  })
})

const plainJpeg = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer()
const plainPng = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

const cfg = (q: number) => ({ widths: [640], formats: ['webp'], sizes: '100vw', quality: q })

const taggedPng = async (path: string) => {
  await sharp({ create: { width: 10, height: 10, channels: 3, background: '#336699' } })
    .png()
    .toFile(path)
  const exiftool = spawnSync('exiftool', ['-q', '-overwrite_original', '-XMP-dc:Description=xmp-survives-test', path], {
    timeout: 30_000,
  })
  return exiftool.status
}

// review 2026-10-24 (follow-up): these wrote beside the test file, and failed in a read-only checkout
describe('XMP preservation', () => {
  let dir: string
  const at = (name: string) => join(dir, name)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hadley-xmp-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('XMP survives sharp resize + format conversion with keepXmp', async () => {
    assert.equal(await taggedPng(at('with.png')), 0)
    await sharp(at('with.png')).resize(5).toFormat('webp', { quality: 80 }).keepXmp().toFile(at('with.webp'))
    const meta = await sharp(at('with.webp')).metadata()
    assert.match(meta.xmp?.toString('utf-8') ?? '', /xmp-survives-test/)
  })

  test('without keepXmp the XMP is lost (control test)', async () => {
    assert.equal(await taggedPng(at('without.png')), 0)
    await sharp(at('without.png')).resize(5).toFormat('webp', { quality: 80 }).toFile(at('without.webp'))
    assert.equal((await sharp(at('without.webp')).metadata()).xmp, undefined)
  })
})

// Privacy by default (2026-11-06): a derivative says nothing of where a photo was taken
const LOCATED_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
 exif:GPSLongitude="7,24.0E" tiff:Orientation="6"
 Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia">
<exif:GPSLatitude>51,30.0N</exif:GPSLatitude><exif:GPSVersionID/><dc:creator>Jane Doe</dc:creator>
</rdf:Description></rdf:RDF></x:xmpmeta>`

describe('the location in an image', () => {
  test('stripLocationFromXmp takes out every GPS property and the orientation, element or attribute, and keeps the rest', () => {
    const cleaned = stripLocationFromXmp(Buffer.from(LOCATED_XMP)).toString('utf-8')
    assert.doesNotMatch(cleaned, /GPS|Orientation/)
    assert.match(cleaned, /<dc:creator>Jane Doe<\/dc:creator>/)
    assert.match(cleaned, /trainedAlgorithmicMedia/)
  })

  test('a location the filter cannot take out leaves the derivative without XMP', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'hadley-location-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const nested = LOCATED_XMP.replace(
      '<dc:creator>',
      '<exif:GPSAreaInformation><rdf:Alt><rdf:li xml:lang="x-default">Dortmund</rdf:li></rdf:Alt></exif:GPSAreaInformation><dc:creator>',
    )
    assert.match(stripLocationFromXmp(Buffer.from(nested)).toString('utf-8'), /Dortmund/)
    const base = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer()
    await writeFile(join(dir, 'photo.jpg'), injectJpegXmp(base, nested))
    const config = { widths: [20], formats: ['webp'], sizes: '100vw', quality: 80 }
    const result = await processImage(
      join(dir, 'photo.jpg'),
      'photo',
      'photo.jpg',
      (name) => join(dir, `out-${name}`),
      config,
      {},
      'test',
      join(dir, 'store'),
    )
    await result.written
    assert.equal((await sharp(join(dir, 'out-photo-20w.webp')).metadata()).xmp, undefined)
  })

  test('a derivative keeps no EXIF and no location, stands upright, and keeps the rest of its XMP', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'hadley-location-test-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const at = (name: string) => join(dir, name)
    // a photo 40 x 20, turned a quarter by its EXIF, which also says where it was taken, as its XMP does
    const base = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer()
    await writeFile(at('photo.jpg'), injectJpegXmp(base, LOCATED_XMP))
    const exiftool = spawnSync(
      'exiftool',
      [
        '-q',
        '-overwrite_original',
        '-EXIF:Orientation#=6',
        '-EXIF:GPSLatitude=51.5',
        '-EXIF:GPSLatitudeRef=N',
        at('photo.jpg'),
      ],
      { timeout: 30_000 },
    )
    assert.equal(exiftool.status, 0)
    assert.ok((await sharp(at('photo.jpg')).metadata()).exif, 'the source has EXIF')
    const config = { widths: [20], formats: ['webp', 'jpeg'], sizes: '100vw', quality: 80 }
    const outputs: string[] = []
    const result = await processImage(
      at('photo.jpg'),
      'photo',
      'photo.jpg',
      (name) => {
        outputs.push(at(`out-${name}`))
        return outputs.at(-1)!
      },
      config,
      {},
      'test',
      at('store'),
    )
    await result.written
    // the size as it stands upright
    assert.deepEqual([result.naturalWidth, result.naturalHeight], [20, 40])
    assert.equal(outputs.length, 2)
    for (const output of outputs) {
      const meta = await sharp(output).metadata()
      assert.equal(meta.exif, undefined, output)
      assert.ok((meta.orientation ?? 1) === 1, output)
      assert.ok((meta.height ?? 0) > (meta.width ?? 0), `${output} stands upright`)
      const xmp = meta.xmp?.toString('utf-8') ?? ''
      assert.doesNotMatch(xmp, /GPS|Orientation/, output)
      assert.match(xmp, /Jane Doe/, output)
    }
  })
})

describe('what is published of a photo', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hadley-published-photo-test-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))
  const at = (name: string) => join(dir, name)
  // its pixels as they are stored, not as they stand
  const pixels = (bytes: Buffer) => sharp(bytes).raw().toBuffer()

  test('exifLocated finds a GPS latitude in EXIF, in either byte order, and nothing in EXIF without one', async () => {
    await locatedPhoto(at('photo.jpg'), 'jpeg')
    assert.equal(exifLocated((await sharp(at('photo.jpg')).metadata()).exif), true)
    const camera = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg()
      .withExif({ IFD0: { Model: 'TestCam' } })
      .toBuffer()
    assert.equal(exifLocated((await sharp(camera).metadata()).exif), false)
    assert.equal(exifLocated(Buffer.from('Exif\0\0II*\0\xff\xff\xff\x7f', 'latin1')), false)
    assert.equal(exifLocated(undefined), false)
  })

  for (const format of ['jpeg', 'png'] as const) {
    test(`a ${format} keeps its pixels and its orientation, and loses its location, camera and serial number`, async () => {
      const source = at(`photo.${format}`)
      await locatedPhoto(source, format)
      assert.match(exifOf(source), /GPSLatitude: 51\.5/)
      const bytes = await readFile(source)
      const meta = await sharp(bytes).metadata()
      await writeFile(at(`out.${format}`), publishedCopy(bytes, publishedXmp(meta.xmp), keptExif(meta)))
      const published = await readFile(at(`out.${format}`))
      assert.ok((await pixels(published)).equals(await pixels(bytes)))
      const tags = exifOf(at(`out.${format}`))
      assert.doesNotMatch(tags, /GPS|Model|SerialNumber/)
      assert.match(tags, /Orientation: 6/)
      assert.match(tags, /Artist: Jane Doe\n/)
      assert.match(tags, /Copyright: \(c\) 2026 Jane Doe\n/)
      const xmp = (await sharp(published).metadata()).xmp?.toString('utf-8') ?? ''
      assert.match(xmp, /Jane Doe/)
      assert.match(xmp, /trainedAlgorithmicMedia/)
    })
  }

  test('upright, a photo keeps no EXIF at all, and without an XMP to keep none of that either', async () => {
    await locatedPhoto(at('photo.png'), 'png', 1, false)
    const bytes = await readFile(at('photo.png'))
    const meta = await sharp(bytes).metadata()
    assert.ok(meta.exif && meta.xmp)
    const published = await sharp(publishedCopy(bytes, null, keptExif({}))).metadata()
    assert.equal(published.exif, undefined)
    assert.equal(published.xmp, undefined)
  })

  test('exifRights reads the artist and each copyright EXIF names, and keptExif writes them back', async () => {
    // a TIFF of one IFD (8 to 37) with an Artist and a Copyright of a photographer and an editor (EXIF 2.32, 4.6.5)
    const tiff = Buffer.alloc(80)
    tiff.write('II*\0\x08\0\0\0', 0, 'latin1')
    tiff.writeUInt16LE(2, 8)
    const artist = Buffer.from('Zoë 山田\0')
    const copyright = Buffer.from('Photo Ann\0Edit Bob\0')
    for (const [i, [tag, value, at]] of (
      [
        [0x013b, artist, 40],
        [0x8298, copyright, 54],
      ] as const
    ).entries()) {
      tiff.writeUInt16LE(tag, 10 + 12 * i)
      tiff.writeUInt16LE(2, 12 + 12 * i)
      tiff.writeUInt32LE(value.length, 14 + 12 * i)
      tiff.writeUInt32LE(at, 18 + 12 * i)
      value.copy(tiff, at)
    }
    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
    const rights = { Artist: 'Zoë 山田', Copyright: 'Photo Ann / Edit Bob' }
    assert.deepEqual(exifRights(exif), rights)
    assert.deepEqual(exifRights(keptExif({ exif, orientation: 1 })!), rights)
    assert.equal(keptExif({ orientation: 1 }), null)
    assert.deepEqual(exifRights(undefined), {})
  })

  test('anything but a JPEG or PNG comes back as it is', () => {
    const pdf = Buffer.from('%PDF-1.7 Exif')
    assert.equal(publishedCopy(pdf, null, keptExif({ orientation: 6 })), pdf)
  })

  test('a derivative the content keeps the EXIF of has it all, stands upright and says it was turned no more', async () => {
    await locatedPhoto(at('photo.jpg'), 'jpeg')
    const config = { widths: [10], formats: ['webp'], sizes: '100vw', quality: 80 }
    const place = (name: string) => at(`out-${name}`)
    const cache = {}
    const kept = await processImage(
      at('photo.jpg'),
      'photo',
      'photo.jpg',
      place,
      config,
      cache,
      'test',
      at('store'),
      'keep',
    )
    await kept.written
    assert.equal(kept.located, false)
    const keptTags = exifOf(at('out-photo-10w.webp'))
    assert.match(keptTags, /GPSLatitude/)
    assert.match(keptTags, /Model: TestCam/)
    assert.match(keptTags, /Orientation: 1/)
    assert.deepEqual([kept.naturalWidth, kept.naturalHeight], [20, 40])
    // made again without it, from the same cache: what it keeps is part of the cache key
    const clean = await processImage(at('photo.jpg'), 'photo', 'photo.jpg', place, config, cache, 'test', at('store'))
    await clean.written
    assert.equal(clean.fromCache, false)
    assert.equal(clean.located, true)
    const tags = exifOf(at('out-photo-10w.webp'))
    assert.doesNotMatch(tags, /GPS|Model/)
    assert.match(tags, /Artist: Jane Doe\n/)
    assert.match(tags, /Copyright: \(c\) 2026 Jane Doe\n/)
  })
})

describe('replaceJpegXmp — removing aiPrompt from a JPEG source', () => {
  test('strips aiPrompt, preserves trainedAlgorithmicMedia', async () => {
    const jpegWithAi = injectJpegXmp(await plainJpeg(), AI_XMP)
    const before = await sharp(jpegWithAi).metadata()
    assert.match(before.xmp?.toString('utf-8') ?? '', /aiPrompt/)

    const clean = replaceJpegXmp(jpegWithAi, stripAiPromptFromXmp(before.xmp!))
    const after = await sharp(clean).metadata()
    assert.doesNotMatch(after.xmp?.toString('utf-8') ?? '', /aiPrompt/)
    assert.match(after.xmp?.toString('utf-8') ?? '', /trainedAlgorithmicMedia/)
  })

  test('JPEG without XMP — buffer unchanged (a valid JPEG)', async () => {
    const result = replaceJpegXmp(await plainJpeg(), Buffer.from(''))
    assert.equal((await sharp(result).metadata()).format, 'jpeg')
  })

  test('clean JPEG source → WebP/AVIF without aiPrompt (end to end)', async () => {
    const jpegWithAi = injectJpegXmp(await plainJpeg(), AI_XMP)
    const xmpBefore = (await sharp(jpegWithAi).metadata()).xmp!
    const cleanSrc = replaceJpegXmp(jpegWithAi, stripAiPromptFromXmp(xmpBefore))

    for (const format of ['webp', 'avif'] as const) {
      const out = await sharp(cleanSrc).resize(3).toFormat(format, { quality: 60 }).withMetadata().toBuffer()
      const xmp = (await sharp(out).metadata()).xmp?.toString('utf-8') ?? ''
      assert.ok(!xmp.includes('aiPrompt'))
      assert.ok(xmp.includes('trainedAlgorithmicMedia'))
    }
  })
})

describe('replacePngXmp — removing aiPrompt from a PNG source', () => {
  test('strips aiPrompt, preserves trainedAlgorithmicMedia', async () => {
    const pngWithAi = injectPngXmp(await plainPng(), AI_XMP)
    const before = await sharp(pngWithAi).metadata()
    assert.match(before.xmp?.toString('utf-8') ?? '', /aiPrompt/)

    const clean = replacePngXmp(pngWithAi, stripAiPromptFromXmp(before.xmp!))
    const after = await sharp(clean).metadata()
    assert.doesNotMatch(after.xmp?.toString('utf-8') ?? '', /aiPrompt/)
    assert.match(after.xmp?.toString('utf-8') ?? '', /trainedAlgorithmicMedia/)
  })

  test('PNG without XMP — buffer unchanged (a valid PNG)', async () => {
    const result = replacePngXmp(await plainPng(), Buffer.from(''))
    assert.equal((await sharp(result).metadata()).format, 'png')
  })

  test('clean PNG source → WebP/AVIF without aiPrompt (end to end)', async () => {
    const pngWithAi = injectPngXmp(await plainPng(), AI_XMP)
    const xmpBefore = (await sharp(pngWithAi).metadata()).xmp!
    const cleanSrc = replacePngXmp(pngWithAi, stripAiPromptFromXmp(xmpBefore))

    for (const format of ['webp', 'avif'] as const) {
      const out = await sharp(cleanSrc).resize(3).toFormat(format, { quality: 60 }).withMetadata().toBuffer()
      const xmp = (await sharp(out).metadata()).xmp?.toString('utf-8') ?? ''
      assert.ok(!xmp.includes('aiPrompt'))
      assert.ok(xmp.includes('trainedAlgorithmicMedia'))
    }
  })
})

describe('resolveConfig', () => {
  const configs: ImageConfigs = { default: cfg(72), cover: cfg(80) }

  test('named key returns matching config', () => {
    assert.equal(resolveConfig(configs, 'cover')?.quality, 80)
  })

  test('undefined key falls back to default', () => {
    assert.equal(resolveConfig(configs, undefined)?.quality, 72)
  })

  test('unknown key falls back to default', () => {
    assert.equal(resolveConfig(configs, 'thumb')?.quality, 72)
  })

  // review 2026-10-23: group=__proto__ found Object.prototype and crashed
  test('a key that names a member of Object falls back to default', () => {
    assert.equal(resolveConfig(configs, '__proto__')?.quality, 72)
    assert.equal(resolveConfig(configs, 'toString')?.quality, 72)
  })

  test('no default and no match → null, which fails the image (has no image config)', () => {
    assert.equal(resolveConfig({ cover: cfg(80) }, undefined), null)
  })
})

describe('extractXmpText', () => {
  const xmp = (content: string) =>
    Buffer.from(`<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      ${content}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`)

  test('simple element', () => {
    const buf = xmp('<photoshop:Credit>Jane Doe / Ideogram</photoshop:Credit>')
    assert.equal(extractXmpText(buf, 'photoshop:Credit'), 'Jane Doe / Ideogram')
  })

  test('container element (rdf:Seq → dc:creator)', () => {
    const buf = xmp('<dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li><rdf:li>Second</rdf:li></rdf:Seq></dc:creator>')
    assert.equal(extractXmpText(buf, 'dc:creator'), 'Jane Doe')
  })

  test('container element (rdf:Alt → dc:description)', () => {
    const buf = xmp(
      '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">A desk, etching style</rdf:li></rdf:Alt></dc:description>',
    )
    assert.equal(extractXmpText(buf, 'dc:description'), 'A desk, etching style')
  })

  test('XML entities decoded', () => {
    const buf = xmp('<photoshop:Credit>Jane &amp; Doe / Ideogram</photoshop:Credit>')
    assert.equal(extractXmpText(buf, 'photoshop:Credit'), 'Jane & Doe / Ideogram')
  })

  // 2026-11-04: teblo.de's structured data said "archivist&#39;s", as ExifTool writes an apostrophe in XMP
  test('character references decoded, decimal and hexadecimal', () => {
    const buf = xmp(
      "<dc:description><rdf:Alt><rdf:li xml:lang='x-default'>An archivist&#39;s stamp &#x2014; O&#X27;Brien</rdf:li></rdf:Alt></dc:description>",
    )
    assert.equal(extractXmpText(buf, 'dc:description'), "An archivist's stamp — O'Brien")
  })

  test('decoded once: an escaped reference stays a reference, and one to no character stays as it is', () => {
    const buf = xmp('<photoshop:Credit>&amp;#39; &#0; &#xD800; &#1114112;</photoshop:Credit>')
    assert.equal(extractXmpText(buf, 'photoshop:Credit'), '&#39; &#0; &#xD800; &#1114112;')
  })

  test('missing field returns undefined', () => {
    const buf = xmp('<photoshop:Credit>Jane Doe</photoshop:Credit>')
    assert.equal(extractXmpText(buf, 'dc:creator'), undefined)
  })
})

describe('copyInto', () => {
  // review 2026-10-26 (dev server): the copy was kept when it was newer than its source, which it need not be a copy
  // of: two bundles that swapped their URL paths kept each other's files
  test('copies the source over a newer copy of another file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hadley-copy-test-'))
    try {
      const [a, b, to] = [join(dir, 'a'), join(dir, 'b'), join(dir, 'sub', 'to')]
      await writeFile(a, 'AAA')
      await writeFile(b, 'BBB')
      await utimes(b, new Date('2020-01-01'), new Date('2020-01-01'))
      await copyInto(a, to)
      await copyInto(b, to)
      assert.equal(await readFile(to, 'utf8'), 'BBB')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ultrareview 2026-10-31: every picture of a build lay in memory at once
describe('pictureTurn', () => {
  test('lets four pictures be made at a time, and the next in as one ends', async () => {
    const turns: (() => void)[] = []
    const waiting = Array.from({ length: 6 }, () => pictureTurn().then((end) => turns.push(end)))
    await new Promise((settled) => setTimeout(settled, 10))
    assert.equal(turns.length, 4)
    turns[0]!()
    await new Promise((settled) => setTimeout(settled, 10))
    assert.equal(turns.length, 5)
    turns[1]!()
    await Promise.all(waiting)
    assert.equal(turns.length, 6)
    for (const end of turns.slice(2)) end()
  })
})

// 2026-11-04: mko.run's badge named Ideogram for a cover made with ChatGPT; the tool is now read from the image
describe('the AI tool an image names', () => {
  const tagged = (field: string) =>
    Buffer.from(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:mko="https://mko.run/ns/1.0/" xmlns:acme="urn:acme">${field}</rdf:Description>
</rdf:RDF></x:xmpmeta>`)

  test('in whatever namespace it is written', () => {
    assert.equal(aiToolOf(tagged('<mko:aiTool>ChatGPT</mko:aiTool>')), 'ChatGPT')
    assert.equal(aiToolOf(tagged('<acme:aiTool>Ideogram 3.0</acme:aiTool>')), 'Ideogram 3.0')
    assert.equal(aiToolOf(tagged('<mko:aiTool>Tom &amp; Jerry&#39;s</mko:aiTool>')), "Tom & Jerry's")
  })

  test('none when the image names none, or an empty one', () => {
    assert.equal(aiToolOf(tagged('<mko:destination>mko.run</mko:destination>')), undefined)
    assert.equal(aiToolOf(tagged('<mko:aiTool></mko:aiTool>')), undefined)
    assert.equal(aiToolOf(undefined), undefined)
  })

  test('comes with the cover, made or from the cache, also from a cache entry written before it was read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hadley-aitool-test-'))
    try {
      const xmp = AI_XMP.replace('<mko:aiPrompt>', '<mko:aiTool>ChatGPT</mko:aiTool>\n      <mko:aiPrompt>')
      const source = join(dir, 'cover.png')
      await writeFile(source, injectPngXmp(await plainPng(), xmp))
      const cover = { rel: 'cover.png', source }
      const cache: ImageCache = {}
      const build = () =>
        buildCover(
          cover,
          { widths: [4], formats: ['webp'], sizes: '100vw', quality: 80 },
          (name) => join(dir, 'out', name),
          '/a/',
          cache,
          join(dir, 'store'),
        )
      const made = await build()
      assert.equal(made.fromCache, false)
      assert.equal(made.aiTool, 'ChatGPT')
      const again = await build()
      assert.equal(again.fromCache, true)
      assert.equal(again.aiTool, 'ChatGPT')
      // an entry of an earlier hadley, without the tool
      delete cache['/a/cover.png']!.aiTool
      const old = await build()
      assert.equal(old.fromCache, true)
      assert.equal(old.aiTool, 'ChatGPT')
      assert.equal(cache['/a/cover.png']!.aiTool, 'ChatGPT')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
