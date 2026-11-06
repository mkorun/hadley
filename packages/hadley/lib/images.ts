/**
 * The images a build makes: each in the widths and formats of its image config, under derivative names next to it
 * (`a-480w.webp`), kept in a store between builds (.hadley/cache/images) and in the image cache (images.json); an
 * AI-generated image keeps its XMP but loses the prompt it was made from. What is published of an image says nothing of
 * where it was taken, nor with what camera, unless the content keeps it (`<m data-exif=keep>`, docs/content.md).
 */
import { createHash } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { mkdir, access, readFile, stat, copyFile, writeFile } from 'node:fs/promises'
import { join as joinPath, extname, dirname, posix } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import type { Picture } from '../case/index.ts'
import type { ListCover } from './site.ts'
import type { ContentFile } from './site-paths.ts'
import { urlOf } from './theme-files.ts'

// sharp keeps the files it read open, by path, for the whole process: a WebP image another program put in place of
// one (an editor, cp) would be made from the old pixels in a dev server, which builds in one process
sharp.cache({ files: 0 })

/** How long sharp may work on one picture of the content: one made to hold a build stops it (docs/content.md). */
export const IMAGE_SECONDS = 60

/**
 * How many pictures are made at a time: each is in memory, whole, until all it is made into is written, and sharp
 * works on four at a time anyway (the threads of its pool). A site of many large pictures waits instead of filling
 * the memory.
 */
const PICTURES_AT_ONCE = 4
let making = 0
const waiting: (() => void)[] = []

/** Waits for a turn to make a picture; the function it gives ends the turn, and hands it to the next that waits. */
export const pictureTurn = async (): Promise<() => void> => {
  if (making < PICTURES_AT_ONCE) making++
  else await new Promise<void>((go) => waiting.push(go))
  return () => {
    const next = waiting.shift()
    if (next) next()
    else making--
  }
}

/**
 * A picture of the content as sharp reads it: its bytes, never its path. Read from a path, an SVG — whatever its name,
 * sharp knows a picture by its bytes — has librsvg load the files its <image> elements name in its folder and below:
 * a picture of the bundle no page names, or of every bundle below the folder of a page that is one file (review
 * 2026-10-29). Read from bytes, it loads none.
 */
export const pictureBytes = (file: string): Promise<Buffer> => readFile(file)

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

// XML's five entities and its character references (&#39;, &#x27;, as ExifTool writes an apostrophe), in one pass, so
// that what one gives is not read again ("&amp;#39;" stays "&#39;"); a reference to no character stays as it is
const decodeXmlText = (s: string): string =>
  s.trim().replace(/&(?:(lt|gt|quot|apos|amp)|#(\d+)|#x([0-9a-f]+));/gi, (whole, name, dec, hex) => {
    if (name) return XML_ENTITIES[name.toLowerCase()] ?? whole
    const code = dec ? Number(dec) : parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })

// Extract a text value from an XMP XML buffer by element name (e.g. "photoshop:Credit").
// Handles both simple elements (<ns:Field>value</ns:Field>) and container elements
// (rdf:Seq / rdf:Bag / rdf:Alt → first rdf:li child). String search, so no pattern is built from the name.
export const extractXmpText = (xmp: Buffer, field: string): string | undefined => {
  const s = xmp.toString('utf-8')
  const open = `<${field}>`
  const start = s.indexOf(open)
  if (start === -1) return undefined
  const end = s.indexOf(`</${field}>`, start)
  if (end === -1) return undefined
  const inner = s.slice(start + open.length, end)
  if (!inner.includes('<')) return inner ? decodeXmlText(inner) : undefined
  const li = inner.indexOf('<rdf:li')
  const textStart = li === -1 ? -1 : inner.indexOf('>', li) + 1
  const textEnd = textStart > 0 ? inner.indexOf('<', textStart) : -1
  return textEnd > textStart ? decodeXmlText(inner.slice(textStart, textEnd)) : undefined
}

// The AI tool an image's XMP names, in whatever namespace the tool that described it uses (aiprov writes `mko:aiTool`);
// none when it names none
export const aiToolOf = (xmp: Buffer | undefined): string | undefined => {
  const named = xmp && /<[\w.-]+:aiTool>([^<]*)<\/[\w.-]+:aiTool>/.exec(xmp.toString('utf-8'))
  return (named && decodeXmlText(named[1]!)) || undefined
}

// Whatever the namespace: matches aiPrompt under any XMP prefix, whichever tool (aiprov or another) described the
// image in whichever namespace; hadley need not know or configure one.
export const stripAiPromptFromXmp = (xmp: Buffer): Buffer => {
  const cleaned = xmp.toString('utf-8').replace(/<[\w-]+:aiPrompt[^>]*>[\s\S]*?<\/[\w-]+:aiPrompt>/g, '')
  return Buffer.from(cleaned)
}

// Where a picture was taken, as XMP names it under any prefix: its GPS position (exif:GPSLatitude and the rest), and
// the place by name (photoshop:City, Iptc4xmpCore:Location, Iptc4xmpExt:LocationCreated with what it holds, …), which
// a photo program can fill from the position. Decided 2026-11-06, to be looked at again.
const XMP_PLACES = new Set([
  'City',
  'State',
  'ProvinceState',
  'Country',
  'CountryCode',
  'CountryName',
  'Sublocation',
  'WorldRegion',
  'Location',
  'LocationCreated',
  'LocationShown',
])
const isXmpPlace = (name: string) => name.startsWith('GPS') || XMP_PLACES.has(name)
// what goes with it: tiff:Orientation would turn again what the derivatives have already turned upright
const goes = (name: string) => isXmpPlace(name) || name === 'Orientation'

const XMP_ELEMENT = /<([\w-]+:(\w+))\b[^>]*>/g
const XMP_ATTRIBUTE = /\s[\w-]+:(\w+)="[^"]*"/g

/** Whether XMP still holds a property `which` takes, as an element or an attribute. */
const holds = (xml: string, which: (name: string) => boolean): boolean =>
  [...xml.matchAll(XMP_ELEMENT)].some((m) => which(m[2]!)) || [...xml.matchAll(XMP_ATTRIBUTE)].some((m) => which(m[1]!))

/**
 * XMP without where its picture was taken, nor its orientation: each such property, as an element with all it holds
 * or as an attribute of an rdf:Description. What else it holds stays: an AI label, its creator, its licence.
 */
export const stripLocationFromXmp = (xmp: Buffer): Buffer => {
  const xml = xmp.toString('utf-8')
  let kept = ''
  let at = 0
  for (const m of xml.matchAll(XMP_ELEMENT)) {
    // inside an element already taken out, or one that stays
    if (m.index < at || !goes(m[2]!)) continue
    const close = `</${m[1]}>`
    const end = m[0].endsWith('/>') ? m.index + m[0].length : xml.indexOf(close, m.index) + close.length
    // an element that is not closed stays, and so the packet is published without its XMP (publishedXmp)
    if (end < m.index + m[0].length) continue
    kept += xml.slice(at, m.index)
    at = end
  }
  kept += xml.slice(at)
  return Buffer.from(kept.replace(XMP_ATTRIBUTE, (whole, name: string) => (goes(name) ? '' : whole)))
}

/** Whether XMP says where its picture was taken. */
const xmpLocated = (xmp: Buffer | undefined): boolean => xmp !== undefined && holds(xmp.toString('utf-8'), isXmpPlace)

/**
 * The XMP a published image keeps of its source's: never a location, nor an AI image's prompt; null for none, also
 * when a location is left that stripLocationFromXmp could not take out.
 */
export const publishedXmp = (xmp: Buffer | undefined): Buffer | null => {
  if (!xmp) return null
  const cleaned = stripLocationFromXmp(isAiXmp(xmp) ? stripAiPromptFromXmp(xmp) : xmp)
  return holds(cleaned.toString('utf-8'), goes) ? null : cleaned
}

/** Whether XMP labels its image as made by a trained model (IPTC Digital Source Type). */
export const isAiXmp = (xmp: Buffer | undefined): boolean =>
  xmp !== undefined && /trainedAlgorithmicMedia/i.test(xmp.toString('utf-8'))

const GPS_IFD = 0x8825
const GPS_LATITUDE = 0x0002
const ORIENTATION = 0x0112
const ASCII = 2
const SHORT = 3
// who made a picture and who holds its rights, as EXIF names them: they go with it wherever it is published
const RIGHTS = { Artist: 0x013b, Copyright: 0x8298 } as const

type Rights = Partial<Record<keyof typeof RIGHTS, string>>

/**
 * The TIFF structure of EXIF as sharp gives it ("Exif\0\0" first), read: an IFD's tags, each with its type, count and
 * value field (a value of up to 4 bytes, else where the value is), and the first IFD. Undefined for none.
 */
const readExif = (exif: Buffer | undefined) => {
  const tiff = exif && startsWith(exif, JPEG_EXIF_NS) ? exif.subarray(JPEG_EXIF_NS.length) : exif
  const order = tiff?.toString('latin1', 0, 2)
  if (!tiff || tiff.length < 8 || (order !== 'MM' && order !== 'II')) return undefined
  const u16 = (at: number) => (order === 'MM' ? tiff.readUInt16BE(at) : tiff.readUInt16LE(at))
  const u32 = (at: number) => (order === 'MM' ? tiff.readUInt32BE(at) : tiff.readUInt32LE(at))
  const ifd = (at: number) => {
    const tags = new Map<number, { type: number; count: number; field: number }>()
    const count = at + 2 <= tiff.length ? u16(at) : 0
    for (let entry = at + 2; entry < at + 2 + 12 * count && entry + 12 <= tiff.length; entry += 12)
      tags.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), field: entry + 8 })
    return tags
  }
  // an ASCII value, without the NUL that ends it; NULs within it (a photographer's and an editor's copyright) as " / "
  const text = ({ type, count, field }: { type: number; count: number; field: number }): string | undefined => {
    const at = count <= 4 ? field : u32(field)
    if (type !== ASCII || at + count > tiff.length) return undefined
    const parts = tiff
      .toString('utf-8', at, at + count)
      .split('\0')
      .map((part) => part.trim())
    return parts.filter(Boolean).join(' / ') || undefined
  }
  return { ifd, text, first: ifd(u32(4)), offset: u32 }
}

/** Whether EXIF, as sharp gives it, says where its picture was taken. */
export const exifLocated = (exif: Buffer | undefined): boolean => {
  const read = readExif(exif)
  const gps = read?.first.get(GPS_IFD)
  return read !== undefined && gps !== undefined && read.ifd(read.offset(gps.field)).has(GPS_LATITUDE)
}

/** The artist and copyright EXIF names, if it names them. */
export const exifRights = (exif: Buffer | undefined): Rights => {
  const read = readExif(exif)
  const rights: Rights = {}
  for (const [name, tag] of Object.entries(RIGHTS) as [keyof typeof RIGHTS, number][]) {
    const entry = read?.first.get(tag)
    const value = entry && read!.text(entry)
    if (value) rights[name] = value
  }
  return rights
}

/** Whether an image's metadata, as sharp reads it, says where it was taken: in its EXIF, its XMP or its IPTC. */
export const located = (meta: { exif?: Buffer | undefined; xmp?: Buffer | undefined; iptc?: Buffer | undefined }) =>
  exifLocated(meta.exif) || xmpLocated(meta.xmp) || iimLocated(meta.iptc)

// IPTC IIM, as a JPEG holds it: a Photoshop resource (0x0404) in its APP13 segment, beside a digest of it (0x0425)
const APP13 = 0xed
const PHOTOSHOP_NS = Buffer.from('Photoshop 3.0\0')
const IIM_RESOURCE = 0x0404
const IIM_DIGEST = 0x0425
// the datasets of record 2 that name a place (IIM 4.2): content location code and name, city, sub-location, province
// or state, country code and name; decided with the XMP_PLACES
const IIM_PLACES = new Set([26, 27, 90, 92, 95, 100, 101])

type Resource = { id: number; head: Buffer; data: Buffer }

/** The resources of an APP13 body ("Photoshop 3.0\0" and 8BIM blocks); undefined for one it cannot read. */
const photoshopResources = (body: Buffer): Resource[] | undefined => {
  if (!startsWith(body, PHOTOSHOP_NS)) return undefined
  const resources: Resource[] = []
  let off = PHOTOSHOP_NS.length
  while (off < body.length) {
    if (off + 12 > body.length || body.toString('latin1', off, off + 4) !== '8BIM') return undefined
    // its name a Pascal string, padded to an even length; its data too
    const sizeAt = off + 6 + ((body[off + 6]! + 2) & ~1)
    if (sizeAt + 4 > body.length) return undefined
    const size = body.readUInt32BE(sizeAt)
    if (sizeAt + 4 + size > body.length) return undefined
    resources.push({
      id: body.readUInt16BE(off + 4),
      head: body.subarray(off, sizeAt),
      data: body.subarray(sizeAt + 4, sizeAt + 4 + size),
    })
    off = sizeAt + 4 + size + (size % 2)
  }
  return resources
}

type Dataset = { record: number; dataset: number; bytes: Buffer }

/** The datasets of IIM; undefined for IIM it cannot read. Zeros after the last one are padding. */
const iimDatasets = (iim: Buffer): Dataset[] | undefined => {
  const datasets: Dataset[] = []
  let off = 0
  while (off < iim.length && iim[off] !== 0) {
    if (iim[off] !== 0x1c || off + 5 > iim.length) return undefined
    let length = iim.readUInt16BE(off + 3)
    let head = 5
    // an extended dataset: the low bits say how many bytes its length takes
    if (length & 0x8000) {
      const bytes = length & 0x7fff
      if (bytes < 1 || bytes > 4 || off + 5 + bytes > iim.length) return undefined
      length = iim.readUIntBE(off + 5, bytes)
      head += bytes
    }
    if (off + head + length > iim.length) return undefined
    datasets.push({ record: iim[off + 1]!, dataset: iim[off + 2]!, bytes: iim.subarray(off, off + head + length) })
    off += head + length
  }
  return datasets
}

const isIimPlace = ({ record, dataset }: Dataset) => record === 2 && IIM_PLACES.has(dataset)

/** Whether IPTC IIM, as sharp gives it (an APP13 body), names where its picture was taken. */
const iimLocated = (iptc: Buffer | undefined): boolean => {
  const iim = iptc && photoshopResources(iptc)?.find(({ id }) => id === IIM_RESOURCE)
  return iim !== undefined && (iimDatasets(iim.data)?.some(isIimPlace) ?? false)
}

/**
 * An APP13 body without the places its IIM names, and without the digest of the IIM that no longer fits it; null for
 * one hadley cannot read, which then goes as a whole.
 */
const withoutIimPlaces = (body: Buffer): Buffer | null => {
  const resources = photoshopResources(body)
  const iim = resources?.find(({ id }) => id === IIM_RESOURCE)
  const datasets = iim && iimDatasets(iim.data)
  if (!resources || (iim && !datasets)) return null
  if (!datasets?.some(isIimPlace)) return body
  const out: Buffer[] = [PHOTOSHOP_NS]
  for (const resource of resources) {
    if (resource.id === IIM_DIGEST) continue
    const data =
      resource === iim ? Buffer.concat(datasets.filter((d) => !isIimPlace(d)).map((d) => d.bytes)) : resource.data
    const size = Buffer.alloc(4)
    size.writeUInt32BE(data.length, 0)
    out.push(resource.head, size, data, Buffer.alloc(data.length % 2))
  }
  return Buffer.concat(out)
}

/** An image's size as it stands upright: an EXIF orientation of 5 to 8 turns it by a quarter. */
export const uprightSize = (meta: Metadata): { width: number; height: number } => {
  const turned = (meta.orientation ?? 1) >= 5
  return { width: (turned ? meta.height : meta.width) ?? 0, height: (turned ? meta.width : meta.height) ?? 0 }
}

// Sharp copies XMP from source at libvips level. Strategy: patch XMP in the source buffer BEFORE passing it to sharp,
// so that every output format (WebP, JPEG, AVIF, …) receives the cleaned XMP that keepXmp() keeps.

const JPEG_XMP_NS = Buffer.from('http://ns.adobe.com/xap/1.0/\0')
const JPEG_XMP_EXTENSION_NS = Buffer.from('http://ns.adobe.com/xmp/extension/\0')
const JPEG_EXIF_NS = Buffer.from('Exif\0\0')
const APP1 = 0xe1

const startsWith = (bytes: Buffer, prefix: Buffer): boolean =>
  bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix)

/**
 * A JPEG with the segments before its scan edited, its pixels untouched: `edit` gives what stands in a segment's place
 * (nothing to take it out), or undefined to keep it. Anything that is no JPEG comes back as it is.
 */
const editJpeg = (jpeg: Buffer, edit: (marker: number, body: Buffer) => Buffer[] | undefined): Buffer => {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const out: Buffer[] = [jpeg.subarray(0, 2)]
  let off = 2
  // up to the start of the scan (0xda) or the end of the image (0xd9); from there on it stays as it is
  while (off + 4 <= jpeg.length && jpeg[off] === 0xff && jpeg[off + 1] !== 0xda && jpeg[off + 1] !== 0xd9) {
    const end = off + 2 + jpeg.readUInt16BE(off + 2)
    out.push(...(edit(jpeg[off + 1]!, jpeg.subarray(off + 4, end)) ?? [jpeg.subarray(off, end)]))
    off = end
  }
  out.push(jpeg.subarray(off))
  return Buffer.concat(out)
}

const jpegSegment = (marker: number, ...body: Buffer[]): Buffer[] => {
  const head = Buffer.from([0xff, marker, 0, 0])
  head.writeUInt16BE(2 + body.reduce((n, part) => n + part.length, 0), 2)
  return [head, ...body]
}

// Replace the XMP APP1 segment in a JPEG buffer without re-decoding the image.
// Also used by generate-og-image.ts to inject XMP after composite().
export const replaceJpegXmp = (jpegBuf: Buffer, cleanXmp: Buffer): Buffer => {
  let replaced = false
  return editJpeg(jpegBuf, (marker, body) => {
    if (replaced || marker !== APP1 || !startsWith(body, JPEG_XMP_NS)) return undefined
    replaced = true
    return jpegSegment(APP1, JPEG_XMP_NS, cleanXmp)
  })
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
// iTXt prefix: keyword + \0 + compression_flag(0) + compression_method(0) + lang\0 + keyword\0
const PNG_XMP_PREFIX = Buffer.from('XML:com.adobe.xmp\0\0\0\0\0')
// the text chunks in which tools wrote a PNG's EXIF and XMP before it had an eXIf chunk (ImageMagick)
const PNG_RAW_EXIF = /^Raw profile type (?:exif|APP1)\x00/
const PNG_RAW_XMP = /^Raw profile type xmp\x00/
// its IPTC, hex in text, which hadley does not read: it goes as a whole
const PNG_RAW_IPTC = /^Raw profile type (?:iptc|8bim)\x00/

/**
 * Whether what a PNG holds packed (its text in zTXt and compressed iTXt, its colour profile in iCCP) unpacks to no more
 * than `limit` bytes in all, which sharp would otherwise unpack whatever the file's size; true for anything that is no
 * PNG, false for packed data that does not unpack.
 */
export const pngUnpacksWithin = (png: Buffer, limit: number): boolean => {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) return true
  let left = limit
  for (let off = 8; off + 12 <= png.length; off += 12 + png.readUInt32BE(off)) {
    const type = png.toString('latin1', off + 4, off + 8)
    const data = png.subarray(off + 8, off + 8 + png.readUInt32BE(off))
    const packed = packedPart(type, data)
    if (!packed) continue
    try {
      left -= inflateSync(packed, { maxOutputLength: Math.max(left, 1) }).length
    } catch {
      return false
    }
    if (left < 0) return false
  }
  return true
}

// what a chunk holds packed: after its keyword and compression method (zTXt, iCCP), or, in an iTXt whose flag says so,
// after its language and translated keyword too
const packedPart = (type: string, data: Buffer): Buffer | undefined => {
  const keyword = data.indexOf(0)
  if (keyword < 0) return undefined
  if (type === 'zTXt' || type === 'iCCP') return data.subarray(keyword + 2)
  if (type !== 'iTXt' || data[keyword + 1] !== 1) return undefined
  const language = data.indexOf(0, keyword + 3)
  const translated = language < 0 ? -1 : data.indexOf(0, language + 1)
  return translated < 0 ? undefined : data.subarray(translated + 1)
}

/**
 * A PNG with its chunks edited, as editJpeg edits a JPEG's segments: `edit` gives what stands in a chunk's place, or
 * undefined to keep it. Anything that is no PNG comes back as it is.
 */
const editPng = (png: Buffer, edit: (type: string, data: Buffer) => Buffer[] | undefined): Buffer => {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) return png
  const out: Buffer[] = [png.subarray(0, 8)]
  let off = 8
  while (off + 12 <= png.length) {
    const end = off + 12 + png.readUInt32BE(off)
    out.push(
      ...(edit(png.toString('latin1', off + 4, off + 8), png.subarray(off + 8, end - 4)) ?? [png.subarray(off, end)]),
    )
    off = end
  }
  if (off < png.length) out.push(png.subarray(off))
  return Buffer.concat(out)
}

const pngChunk = (type: string, data: Buffer): Buffer[] => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data]), 0) >>> 0, 0)
  return [head, data, crc]
}

const isPngXmp = (type: string, data: Buffer) => type === 'iTXt' && startsWith(data, PNG_XMP_PREFIX)

// Replace the XMP iTXt chunk in a PNG buffer without re-decoding the image.
export const replacePngXmp = (pngBuf: Buffer, cleanXmp: Buffer): Buffer =>
  editPng(pngBuf, (type, data) =>
    isPngXmp(type, data) ? pngChunk('iTXt', Buffer.concat([PNG_XMP_PREFIX, cleanXmp])) : undefined,
  )

/**
 * The EXIF a picture keeps of its own when it is published without it: how it is turned, who made it and who holds its
 * rights, as a TIFF structure of one IFD; null when it has none of them.
 */
export const keptExif = (meta: { exif?: Buffer | undefined; orientation?: number | undefined }): Buffer | null => {
  const entries: { tag: number; type: number; value: Buffer }[] = []
  const orientation = meta.orientation ?? 1
  if (orientation !== 1) entries.push({ tag: ORIENTATION, type: SHORT, value: Buffer.from([0, orientation, 0, 0]) })
  for (const [name, value] of Object.entries(exifRights(meta.exif)) as [keyof typeof RIGHTS, string][])
    entries.push({ tag: RIGHTS[name], type: ASCII, value: Buffer.from(`${value}\0`) })
  if (entries.length === 0) return null
  // big-endian: the header, the IFD (its count, its entries, no next IFD), then each value its field cannot hold
  const ifdEnd = 8 + 2 + 12 * entries.length + 4
  const head = Buffer.alloc(ifdEnd)
  head.write('MM', 0, 'latin1')
  head.writeUInt16BE(42, 2)
  head.writeUInt32BE(8, 4)
  head.writeUInt16BE(entries.length, 8)
  const values: Buffer[] = []
  let at = ifdEnd
  entries.forEach(({ tag, type, value }, i) => {
    const entry = 10 + 12 * i
    head.writeUInt16BE(tag, entry)
    head.writeUInt16BE(type, entry + 2)
    head.writeUInt32BE(type === SHORT ? 1 : value.length, entry + 4)
    if (type === SHORT || value.length <= 4) value.copy(head, entry + 8)
    else {
      head.writeUInt32BE(at, entry + 8)
      // each value on a word boundary
      const padded = value.length % 2 ? Buffer.concat([value, Buffer.alloc(1)]) : value
      values.push(padded)
      at += padded.length
    }
  })
  return Buffer.concat([head, ...values])
}

/**
 * A JPEG or PNG as it is published without its EXIF: in place of that `exif` (keptExif: its orientation, so that it
 * still stands as its camera meant, and its rights), in place of its XMP `xmp`, or none for null, and its IPTC without
 * the places it names; its pixels and every other segment or chunk as they are. Anything else comes back as it is.
 */
export const publishedCopy = (bytes: Buffer, xmp: Buffer | null, kept: Buffer | null): Buffer => {
  let written = kept === null
  // in place of the first EXIF what it keeps; any other EXIF goes
  const exif = (write: (tiff: Buffer) => Buffer[]): Buffer[] => {
    if (written) return []
    written = true
    return write(kept!)
  }
  const jpeg = editJpeg(bytes, (marker, body) => {
    if (marker !== APP1) return undefined
    if (startsWith(body, JPEG_EXIF_NS)) return exif((tiff) => jpegSegment(APP1, JPEG_EXIF_NS, tiff))
    if (startsWith(body, JPEG_XMP_NS)) return xmp ? jpegSegment(APP1, JPEG_XMP_NS, xmp) : []
    // the rest of an XMP packet too large for one segment
    if (startsWith(body, JPEG_XMP_EXTENSION_NS)) return []
    return undefined
  })
  // the IIM without the places it names
  const iim = editJpeg(jpeg, (marker, body) => {
    if (marker !== APP13 || !startsWith(body, PHOTOSHOP_NS)) return undefined
    const cleaned = withoutIimPlaces(body)
    return cleaned === body ? undefined : cleaned ? jpegSegment(APP13, cleaned) : []
  })
  return editPng(iim, (type, data) => {
    if (type === 'eXIf') return exif((tiff) => pngChunk('eXIf', tiff))
    if (isPngXmp(type, data)) return xmp ? pngChunk('iTXt', Buffer.concat([PNG_XMP_PREFIX, xmp])) : []
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return undefined
    const keyword = data.toString('latin1', 0, 32)
    if (PNG_RAW_EXIF.test(keyword)) return exif((tiff) => pngChunk('eXIf', tiff))
    return PNG_RAW_XMP.test(keyword) || PNG_RAW_IPTC.test(keyword) ? [] : undefined
  })
}

export interface ImageConfig {
  widths: number[]
  formats: string[]
  sizes: string
  quality: number
}

export type ImageConfigs = Record<string, ImageConfig>

export interface CacheEntry {
  // the source file's last change (its ctime): any write, and any reset of its modification time, changes it
  sourceChanged: number
  title?: string // an og image's: the page title it shows
  configHash: string
  naturalWidth: number
  naturalHeight: number
  validWidths: number[]
  isAi?: boolean
  // the AI tool its XMP names (aiToolOf), null for none; undefined in an entry written before hadley read it
  aiTool?: string | null
  // undefined when the source image carries no XMP metadata; JSON.stringify drops it from the cache file
  creator?: string | undefined
  creditText?: string | undefined
  imageDescription?: string | undefined
  located?: true // its source said where it was taken, which its derivatives do not
}

export type ImageCache = Record<string, CacheEntry>

export type AiLabels = { badge: string; altSuffix: string }

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Claims a file of a page's output directory by its name there and returns its path (lib/output.ts). */
export type Place = (name: string) => string

/**
 * Copies `from` to `to`, always: a dev build keeps its output, and a copy there may be of another source than this
 * one (two bundles that swapped their URL paths), which no time of either file tells.
 */
export const copyInto = async (from: string, to: string): Promise<void> => {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

/** Writes a file of a page's output directory that `place` claimed: a picture as it is published (publishedCopy). */
export const writeInto = async (to: string, bytes: Buffer): Promise<void> => {
  await mkdir(dirname(to), { recursive: true })
  await writeFile(to, bytes)
}

/**
 * The name of an image's derivative in the page's output directory: next to where the image lies in the bundle, so
 * `sub/a.png` and `a.png` do not share one.
 */
const derivativeName = (rel: string, width: number, format: string): string => {
  const dir = posix.dirname(rel)
  return posix.join(dir, `${posix.basename(rel, posix.extname(rel))}-${width}w.${format}`)
}

// work a caller awaits later: until then, its failure is not unhandled
const handled = <T>(work: Promise<T>): Promise<T> => {
  work.catch(() => {})
  return work
}

// What a derivative holds besides its pixels, by default and where the content keeps the EXIF: privacy by default
// since 2026-11-06 (EXIF and the location gone, the orientation applied); a change here makes every derivative again.
const DERIVATIVE_METADATA = { clean: 'icc+xmp+rights, no location', keep: 'all but a prompt, upright' }

/**
 * The derivatives of an image in the widths and formats of its config: copied from the store when the cache has them,
 * else made there and copied. Every name is claimed (`place`) before it returns; `written` is the work that is still
 * running, so that a caller can make several images at once and still claim their names in its own order.
 */
export const processImage = async (
  sourceFile: string,
  cacheKey: string,
  rel: string,
  place: Place,
  imageConfig: ImageConfig,
  cache: ImageCache,
  configHash: string,
  store: string, // where derivatives are kept between builds, of either kind
  exif: 'clean' | 'keep' = 'clean', // keep: as the content asks (`<m data-exif=keep>`), location and all
): Promise<{
  naturalWidth: number
  naturalHeight: number
  validWidths: number[]
  isAi: boolean
  aiTool: string | undefined
  located: boolean // a location of the source was left out
  fromCache: boolean
  written: Promise<void>
}> => {
  const sourceChanged = (await stat(sourceFile)).ctimeMs
  const cached = cache[cacheKey]
  // kept by the image they were made from, as the cache entry is: a.png and a.jpg both have a-4w.webp. The hash of
  // its path names the directory, so no image's directory can lie in another's.
  const kept = (name: string) =>
    joinPath(store, createHash('sha256').update(rel).digest('hex').slice(0, 16), posix.basename(name))

  // Cache hit: source and config unchanged — but only trust it once every expected derivate
  // file actually exists (not just mtime/configHash), else a partially cleaned output dir
  // would silently serve missing images.
  const derivativeKey = `${configHash} ${DERIVATIVE_METADATA[exif]}`
  if (cached && cached.sourceChanged === sourceChanged && cached.configHash === derivativeKey) {
    const expectedFiles = imageConfig.formats.flatMap((format) =>
      cached.validWidths.map((w) => derivativeName(rel, w, format)),
    )
    // copied from the store, where the build that made them left them
    const stored = await Promise.all(expectedFiles.map((f) => fileExists(kept(f))))
    if (stored.every(Boolean)) {
      // an entry from before hadley read the tool: read from the source's metadata alone, nothing made again
      cached.aiTool ??= aiToolOf((await sharp(await pictureBytes(sourceFile)).metadata()).xmp) ?? null
      // every name claimed before any is written, as when they are made
      const targets = expectedFiles.map((f) => place(f))
      const written = Promise.all(expectedFiles.map((f, i) => copyInto(kept(f), targets[i]!))).then(() => {})
      return {
        naturalWidth: cached.naturalWidth,
        naturalHeight: cached.naturalHeight,
        validWidths: cached.validWidths,
        isAi: cached.isAi ?? false,
        aiTool: cached.aiTool ?? undefined,
        located: cached.located ?? false,
        fromCache: true,
        written: handled(written),
      }
    }
    // a derivative missing from the store (`hadley clean`, or removed by hand) → made again
  }

  // Generate from source, in its turn; the turn lasts until all it is made into is written
  const endTurn = await pictureTurn()
  let written: Promise<void> | undefined
  try {
    const source = await pictureBytes(sourceFile)
    const meta = await sharp(source).metadata()
    const { width: naturalWidth, height: naturalHeight } = uprightSize(meta)
    const validWidths = imageConfig.widths.filter((w) => w <= naturalWidth)
    if (validWidths.length === 0 && naturalWidth > 0) validWidths.push(naturalWidth)

    const isAi = isAiXmp(meta.xmp)
    const aiTool = aiToolOf(meta.xmp)
    const keep = exif === 'keep'
    const leftOut = !keep && located(meta)
    const rights = exifRights(meta.exif)

    // The XMP the derivatives keep, patched in the source buffer before sharp reads it: never a location (unless the
    // content keeps it), and for an AI image no prompt. A source whose XMP cannot be patched in place (neither JPEG nor
    // PNG) keeps none.
    let sharpInput = source
    let keepXmp = false
    const cleanXmp = keep ? (isAi && meta.xmp ? stripAiPromptFromXmp(meta.xmp) : null) : publishedXmp(meta.xmp)
    if (cleanXmp) {
      const ext = extname(sourceFile).toLowerCase()
      if (ext === '.jpg' || ext === '.jpeg') sharpInput = replaceJpegXmp(source, cleanXmp)
      else if (ext === '.png') sharpInput = replacePngXmp(source, cleanXmp)
      // kept only when the patched source now holds exactly the cleaned packet
      keepXmp = (await sharp(sharpInput).metadata()).xmp?.equals(cleanXmp) ?? false
    }

    // every name claimed before any is made: a conflict stops at the first, whatever the cache holds
    const names = imageConfig.formats.flatMap((format) => validWidths.map((w) => ({ w, format })))
    const targets = names.map(({ w, format }) => place(derivativeName(rel, w, format)))
    written = Promise.all(
      names.map(async ({ w, format }, i) => {
        const name = derivativeName(rel, w, format)
        await mkdir(dirname(kept(name)), { recursive: true })
        // upright, in its own colours, with the cleaned XMP; of its EXIF only its artist and copyright, so no
        // location, camera or serial number. Kept, it has all its source had but a prompt, its orientation upright.
        let derivative = sharp(sharpInput)
          .timeout({ seconds: IMAGE_SECONDS })
          .autoOrient()
          .resize(w)
          .toFormat(format as any, { quality: imageConfig.quality })
        if (keep) derivative = derivative.keepMetadata()
        else {
          derivative = derivative.keepIccProfile()
          // libvips writes them as ASCII, as EXIF has it ("Jürgen" as "Jurgen"); the XMP keeps them as they are
          if (Object.keys(rights).length) derivative = derivative.withExif({ IFD0: rights })
          if (keepXmp) derivative = derivative.keepXmp()
        }
        await derivative.toFile(kept(name))
        await copyInto(kept(name), targets[i]!)
      }),
    ).then(() => {
      cache[cacheKey] = {
        sourceChanged,
        configHash: derivativeKey,
        naturalWidth,
        naturalHeight,
        validWidths,
        isAi,
        aiTool: aiTool ?? null,
        ...(leftOut ? { located: true as const } : {}),
      }
    })

    return {
      naturalWidth,
      naturalHeight,
      validWidths,
      isAi,
      aiTool,
      located: leftOut,
      fromCache: false,
      written: handled(written),
    }
  } finally {
    if (written) void written.then(endTurn, endTurn)
    else endTurn()
  }
}

/** The image config `key` selects, else the template's default, else null. */
export const resolveConfig = (imageConfigs: ImageConfigs, key: string | undefined): ImageConfig | null => {
  // own keys only: a group named __proto__ or toString must not find Object's members
  const cfg = key && Object.hasOwn(imageConfigs, key) ? imageConfigs[key] : imageConfigs['default']
  return cfg ?? null
}

/**
 * Who a derivative belongs to: its source and quality. Width and format are in its name, so two images of a page that
 * share an owner write the same bytes, and two that do not cannot share a file.
 */
export const derivativeOwner = (rel: string, cfg: ImageConfig): string => `${rel} (quality ${cfg.quality})`

/**
 * The picture of an image processImage built, named as processImage names its files; `base` goes before each of its
 * paths (a page's URL path, for a list on another page).
 */
export const pictureOf = (
  rel: string,
  result: { naturalWidth: number; naturalHeight: number; validWidths: number[] },
  cfg: ImageConfig,
  base = '',
): Picture => ({
  src: urlOf(base + derivativeName(rel, result.validWidths[0]!, cfg.formats[0]!)),
  width: result.naturalWidth,
  height: result.naturalHeight,
  sizes: cfg.sizes,
  sources: cfg.formats.map((format) => ({
    type: `image/${format}`,
    srcset: result.validWidths.map((w) => `${urlOf(base + derivativeName(rel, w, format))} ${w}w`).join(', '),
  })),
})

/** The cover's picture, built with the template's `cover` image config. */
export const buildCover = async (
  cover: ContentFile,
  cfg: ImageConfig,
  place: Place,
  urlPath: string,
  cache: ImageCache,
  store: string,
  base = '', // what the page's own picture is named from: its URL path for an error page, which shows at any address
): Promise<{
  picture: Picture
  listCover: ListCover
  isAiGenerated: boolean
  aiTool: string | undefined
  fromCache: boolean
}> => {
  const result = await processImage(
    cover.source,
    urlPath + cover.rel,
    cover.rel,
    place,
    cfg,
    cache,
    JSON.stringify(cfg),
    store,
  )
  await result.written
  const { sizes: _sizes, ...listCover } = pictureOf(cover.rel, result, cfg, urlPath)
  return {
    picture: pictureOf(cover.rel, result, cfg, base),
    listCover,
    isAiGenerated: result.isAi,
    aiTool: result.aiTool,
    fromCache: result.fromCache,
  }
}
