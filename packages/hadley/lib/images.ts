/**
 * The images a build makes: each in the widths and formats of its image config, under derivative names next to it
 * (`a-480w.webp`), kept in a store between builds (.hadley/cache/images) and in the image cache (images.json); an
 * AI-generated image keeps its XMP but loses the prompt it was made from.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { mkdir, access, readFile, stat, copyFile } from 'node:fs/promises'
import { join as joinPath, extname, dirname, posix } from 'node:path'
import { crc32 } from 'node:zlib'
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

// Whatever the namespace: matches aiPrompt under any XMP prefix, whichever tool (aiprov or another) described the
// image in whichever namespace; hadley need not know or configure one.
export const stripAiPromptFromXmp = (xmp: Buffer): Buffer => {
  const cleaned = xmp.toString('utf-8').replace(/<[\w-]+:aiPrompt[^>]*>[\s\S]*?<\/[\w-]+:aiPrompt>/g, '')
  return Buffer.from(cleaned)
}

// Sharp copies XMP from source at libvips level regardless of withMetadata() options.
// Strategy: patch XMP in the source buffer BEFORE passing to sharp, so all output
// formats (WebP, JPEG, AVIF, …) automatically receive the cleaned XMP via withMetadata().

const JPEG_XMP_NS = Buffer.from('http://ns.adobe.com/xap/1.0/\0')

// Replace the XMP APP1 segment in a JPEG buffer without re-decoding the image.
// Also used by generate-og-image.ts to inject XMP after composite().
export const replaceJpegXmp = (jpegBuf: Buffer, cleanXmp: Buffer): Buffer => {
  if (jpegBuf.length < 2 || jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) return jpegBuf
  const out: Buffer[] = [jpegBuf.subarray(0, 2)]
  let off = 2,
    replaced = false
  while (off + 4 <= jpegBuf.length) {
    if (jpegBuf[off] !== 0xff) {
      out.push(jpegBuf.subarray(off))
      break
    }
    const marker = jpegBuf[off + 1]
    if (marker === 0xd9 || marker === 0xda) {
      out.push(jpegBuf.subarray(off))
      off = jpegBuf.length
      break
    }
    const segLen = jpegBuf.readUInt16BE(off + 2)
    const segEnd = off + 2 + segLen
    if (marker === 0xe1 && !replaced) {
      const body = jpegBuf.subarray(off + 4, segEnd)
      if (body.length >= JPEG_XMP_NS.length && body.subarray(0, JPEG_XMP_NS.length).equals(JPEG_XMP_NS)) {
        const hdr = Buffer.allocUnsafe(4)
        hdr[0] = 0xff
        hdr[1] = 0xe1
        hdr.writeUInt16BE(2 + JPEG_XMP_NS.length + cleanXmp.length, 2)
        out.push(hdr, JPEG_XMP_NS, cleanXmp)
        replaced = true
        off = segEnd
        continue
      }
    }
    out.push(jpegBuf.subarray(off, segEnd))
    off = segEnd
  }
  if (off < jpegBuf.length) out.push(jpegBuf.subarray(off))
  return Buffer.concat(out)
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_ITXT = Buffer.from('iTXt')
// iTXt prefix: keyword + \0 + compression_flag(0) + compression_method(0) + lang\0 + keyword\0
const PNG_XMP_PREFIX = Buffer.from('XML:com.adobe.xmp\0\0\0\0\0')

// Replace the XMP iTXt chunk in a PNG buffer without re-decoding the image.
export const replacePngXmp = (pngBuf: Buffer, cleanXmp: Buffer): Buffer => {
  if (pngBuf.length < 8 || !pngBuf.subarray(0, 8).equals(PNG_SIG)) return pngBuf
  const out: Buffer[] = [pngBuf.subarray(0, 8)]
  let off = 8
  while (off + 12 <= pngBuf.length) {
    const dataLen = pngBuf.readUInt32BE(off)
    const chunkEnd = off + 12 + dataLen
    const type = pngBuf.subarray(off + 4, off + 8)
    const data = pngBuf.subarray(off + 8, off + 8 + dataLen)
    if (
      type.equals(PNG_ITXT) &&
      data.length >= PNG_XMP_PREFIX.length &&
      data.subarray(0, PNG_XMP_PREFIX.length).equals(PNG_XMP_PREFIX)
    ) {
      const newData = Buffer.concat([PNG_XMP_PREFIX, cleanXmp])
      const lenBuf = Buffer.allocUnsafe(4)
      lenBuf.writeUInt32BE(newData.length, 0)
      const crcVal = crc32(Buffer.concat([PNG_ITXT, newData]), 0) >>> 0
      const crcBuf = Buffer.allocUnsafe(4)
      crcBuf.writeUInt32BE(crcVal, 0)
      out.push(lenBuf, PNG_ITXT, newData, crcBuf)
    } else {
      out.push(pngBuf.subarray(off, chunkEnd))
    }
    off = chunkEnd
  }
  if (off < pngBuf.length) out.push(pngBuf.subarray(off))
  return Buffer.concat(out)
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
  // undefined when the source image carries no XMP metadata; JSON.stringify drops it from the cache file
  creditText?: string | undefined
  imageDescription?: string | undefined
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
): Promise<{
  naturalWidth: number
  naturalHeight: number
  validWidths: number[]
  isAi: boolean
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
  if (cached && cached.sourceChanged === sourceChanged && cached.configHash === configHash) {
    const expectedFiles = imageConfig.formats.flatMap((format) =>
      cached.validWidths.map((w) => derivativeName(rel, w, format)),
    )
    // copied from the store, where the build that made them left them
    const stored = await Promise.all(expectedFiles.map((f) => fileExists(kept(f))))
    if (stored.every(Boolean)) {
      // every name claimed before any is written, as when they are made
      const targets = expectedFiles.map((f) => place(f))
      const written = Promise.all(expectedFiles.map((f, i) => copyInto(kept(f), targets[i]!))).then(() => {})
      return {
        naturalWidth: cached.naturalWidth,
        naturalHeight: cached.naturalHeight,
        validWidths: cached.validWidths,
        isAi: cached.isAi ?? false,
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
    const naturalWidth = meta.width ?? 0
    const naturalHeight = meta.height ?? 0
    const validWidths = imageConfig.widths.filter((w) => w <= naturalWidth)
    if (validWidths.length === 0 && naturalWidth > 0) validWidths.push(naturalWidth)

    const isAi = meta.xmp !== undefined && /trainedAlgorithmicMedia/i.test(meta.xmp.toString('utf-8'))

    // For AI images: patch aiPrompt out of the source buffer before handing to sharp.
    // libvips copies XMP from source at decode time regardless of withMetadata() options,
    // so cleaning it at the source works for every output format (WebP, JPEG, AVIF, …).
    let sharpInput = source
    if (isAi && meta.xmp) {
      const cleanXmp = stripAiPromptFromXmp(meta.xmp)
      const ext = extname(sourceFile).toLowerCase()
      if (ext === '.jpg' || ext === '.jpeg') sharpInput = replaceJpegXmp(source, cleanXmp)
      else if (ext === '.png') sharpInput = replacePngXmp(source, cleanXmp)
      // SVG: no binary XMP chunk; AI-tagged SVGs not expected in this pipeline
    }

    // every name claimed before any is made: a conflict stops at the first, whatever the cache holds
    const names = imageConfig.formats.flatMap((format) => validWidths.map((w) => ({ w, format })))
    const targets = names.map(({ w, format }) => place(derivativeName(rel, w, format)))
    written = Promise.all(
      names.map(async ({ w, format }, i) => {
        const name = derivativeName(rel, w, format)
        await mkdir(dirname(kept(name)), { recursive: true })
        await sharp(sharpInput)
          .timeout({ seconds: IMAGE_SECONDS })
          .resize(w)
          .toFormat(format as any, { quality: imageConfig.quality })
          .withMetadata()
          .toFile(kept(name))
        await copyInto(kept(name), targets[i]!)
      }),
    ).then(() => {
      cache[cacheKey] = { sourceChanged, configHash, naturalWidth, naturalHeight, validWidths, isAi }
    })

    return { naturalWidth, naturalHeight, validWidths, isAi, fromCache: false, written: handled(written) }
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
  src: base + urlOf(derivativeName(rel, result.validWidths[0]!, cfg.formats[0]!)),
  width: result.naturalWidth,
  height: result.naturalHeight,
  sizes: cfg.sizes,
  sources: cfg.formats.map((format) => ({
    type: `image/${format}`,
    srcset: result.validWidths.map((w) => `${base}${urlOf(derivativeName(rel, w, format))} ${w}w`).join(', '),
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
): Promise<{ picture: Picture; listCover: ListCover; isAiGenerated: boolean; fromCache: boolean }> => {
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
    fromCache: result.fromCache,
  }
}
