import { describe, test, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyInto,
  pictureTurn,
  resolveConfig,
  replaceJpegXmp,
  replacePngXmp,
  stripAiPromptFromXmp,
  type ImageConfigs,
} from '../images.ts'
import { extractXmpText } from '../generate-og-image.ts'
import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { crc32 } from 'node:zlib'

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
describe('withMetadata XMP preservation', () => {
  let dir: string
  const at = (name: string) => join(dir, name)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hadley-xmp-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('XMP survives sharp resize + format conversion', async () => {
    assert.equal(await taggedPng(at('with.png')), 0)
    await sharp(at('with.png')).resize(5).toFormat('webp', { quality: 80 }).withMetadata().toFile(at('with.webp'))
    const meta = await sharp(at('with.webp')).metadata()
    assert.match(meta.xmp?.toString('utf-8') ?? '', /xmp-survives-test/)
  })

  test('without withMetadata the XMP is lost (control test)', async () => {
    assert.equal(await taggedPng(at('without.png')), 0)
    await sharp(at('without.png')).resize(5).toFormat('webp', { quality: 80 }).toFile(at('without.webp'))
    assert.equal((await sharp(at('without.webp')).metadata()).xmp, undefined)
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
