/**
 * generate-og-image.ts
 *
 * Generates a 1200×630 og:image from an article's cover or first bundle image, resolved by build-files.ts.
 *
 * Strategy:
 *   - Portrait images (width < height) → cover/crop centered to 1200×630
 *   - Landscape/square images          → contain + pad with #fcfcfc background
 *
 * Overlay, from the site's OgDesign (lib/og.ts):
 *   - Dark gradient at bottom third
 *   - Site logo (bottom-left)
 *   - Site tagline (right of logo)
 *   - Article title (above logo row, max 2 lines, Noto Sans Bold)
 *   - AI badge (bottom-right, if image is AI-generated)
 *
 * Output: the page's og.jpg
 * Cache:  reuses ImageCache from build-files.ts (key: "og:{urlPath}{rel}")
 *
 * System requirement: fonts-noto-core (sudo apt install -y fonts-noto-core)
 * librsvg (bundled with sharp prebuilts) uses fontconfig to resolve 'Noto Sans'.
 */

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { copyFile, mkdir, stat, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { IMAGE_SECONDS, pictureBytes, pictureTurn, stripAiPromptFromXmp, type ImageCache } from './images.ts'
import type { ContentFile } from './site-paths.ts'
import type { OgDesign } from './og.ts'
import type { Page } from './site.ts'
import { element, xmlDocument, type XmlElement } from './xml.ts'

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const OG_BG = { r: 252, g: 252, b: 252, alpha: 1 as const }
// Bump version when overlay design changes to invalidate the cache
const OG_CONFIG_HASH = 'og:1200x630:v13'

// Insert XMP APP1 segment after SOI — skip APP0 (JFIF) if present so the
// JFIF spec (APP0 must immediately follow SOI) is not violated.
const XMP_NS_MARKER = Buffer.from('http://ns.adobe.com/xap/1.0/\0')
const injectJpegXmp = (jpegBuf: Buffer, xmpBuf: Buffer): Buffer => {
  const segBodyLen = XMP_NS_MARKER.length + xmpBuf.length
  const seg = Buffer.allocUnsafe(4 + segBodyLen)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg.writeUInt16BE(2 + segBodyLen, 2) // length includes the 2 length bytes
  XMP_NS_MARKER.copy(seg, 4)
  xmpBuf.copy(seg, 4 + XMP_NS_MARKER.length)
  let insertAt = 2
  if (jpegBuf[2] === 0xff && jpegBuf[3] === 0xe0) insertAt = 4 + jpegBuf.readUInt16BE(4)
  return Buffer.concat([jpegBuf.subarray(0, insertAt), seg, jpegBuf.subarray(insertAt)])
}

const decodeXmlText = (s: string): string =>
  s
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

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

// Approximate text wrapping for Noto Sans Bold.
// Noto Sans Bold ≈ 0.59 em average character width.
const wrapTitle = (text: string, availPx: number, fontSize: number, maxLines: number): string[] => {
  const avgW = fontSize * 0.59
  const maxChars = Math.floor(availPx / avgW)
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const candidate = cur ? `${cur} ${word}` : word
    if (candidate.length > maxChars && cur) {
      lines.push(cur)
      if (lines.length === maxLines - 1) {
        // Last line: join remaining, truncate if needed
        const rest = words.slice(i).join(' ')
        lines.push(rest.length > maxChars ? rest.slice(0, maxChars - 1) + '…' : rest)
        return lines
      }
      cur = word
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

/** The overlay of an og image, as an SVG document: the title is content, the tagline config, both text in it. */
export const buildOverlay = (
  title: string,
  tagline: string,
  logoB64: string,
  logoAspect: number,
  logoMime: string,
  aiBadgeB64: string,
  isAi: boolean,
  shade: string,
): Buffer => {
  const W = OG_WIDTH,
    H = OG_HEIGHT
  const PAD = 44
  const TITLE_SIZE = 50
  const TITLE_LINE_H = 64
  const FONT = "'Noto Sans','DejaVu Sans',Arial,sans-serif"

  // Logo dimensions: aspect ratio read from the site's own logo file (see resolveLogoPath)
  const LOGO_H = 63
  const LOGO_W = Math.round(LOGO_H * logoAspect)
  const LOGO_Y = H - PAD - LOGO_H // 523 — bottom row

  // Tagline: slightly above the logo's baseline (≈86% of logo height)
  const TAGLINE_Y = LOGO_Y + Math.round(LOGO_H * 0.86)

  // Title: bottom line anchored 24 px above logo row
  const TITLE_GAP = 24
  const lastTitleY = LOGO_Y - TITLE_GAP // 499

  const titleLines = wrapTitle(title, W - PAD * 2, TITLE_SIZE, 2)
  const titleYs = titleLines.length === 1 ? [lastTitleY] : [lastTitleY - TITLE_LINE_H, lastTitleY]

  // Gradient: transparent above, the site's --og-background at the bottom
  const stop = (offset: string, opacity: string) =>
    element('stop', [
      ['offset', offset],
      ['stop-color', shade],
      ['stop-opacity', opacity],
    ])
  const text = (x: number, y: number, attrs: XmlElement['attrs'], value: string) =>
    element('text', [['x', `${x}`], ['y', `${y}`], ['font-family', FONT], ...attrs], value)

  const layers: XmlElement[] = [
    element(
      'defs',
      [],
      element(
        'linearGradient',
        [
          ['id', 'og'],
          ['x1', '0'],
          ['y1', '0'],
          ['x2', '0'],
          ['y2', '1'],
        ],
        stop('0.42', '0'),
        stop('0.68', '0.78'),
        stop('1', '0.93'),
      ),
    ),
    element('rect', [
      ['width', `${W}`],
      ['height', `${H}`],
      ['fill', 'url(#og)'],
    ]),
    element('image', [
      ['href', `data:${logoMime};base64,${logoB64}`],
      ['x', `${PAD}`],
      ['y', `${LOGO_Y}`],
      ['width', `${LOGO_W}`],
      ['height', `${LOGO_H}`],
    ]),
  ]
  if (tagline) {
    const attrs: XmlElement['attrs'] = [
      ['font-size', '28'],
      ['fill', 'white'],
      ['opacity', '0.7'],
    ]
    layers.push(text(PAD + LOGO_W + 28, TAGLINE_Y, attrs, tagline))
  }
  titleLines.forEach((line, i) => {
    const attrs: XmlElement['attrs'] = [
      ['font-size', `${TITLE_SIZE}`],
      ['font-weight', 'bold'],
      ['fill', 'white'],
    ]
    layers.push(text(PAD, titleYs[i]!, attrs, line))
  })

  // AI badge (bottom-right): ai-badge.svg (viewBox="0 0 1140 512") in white, at 48×22 px
  if (isAi) {
    const BW = 48,
      BH = Math.round((BW * 512) / 1140)
    layers.push(
      element('image', [
        ['href', `data:image/svg+xml;base64,${aiBadgeB64}`],
        ['x', `${W - PAD - BW}`],
        ['y', `${H - PAD - BH}`],
        ['width', `${BW}`],
        ['height', `${BH}`],
        ['opacity', '0.85'],
        ['style', 'filter:invert(1) brightness(2)'],
      ]),
    )
  }

  const svg = element(
    'svg',
    [
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['xmlns:xlink', 'http://www.w3.org/1999/xlink'],
      ['width', `${W}`],
      ['height', `${H}`],
    ],
    ...layers,
  )
  return Buffer.from(xmlDocument(svg))
}

export interface OgImageResult {
  result: 'generated' | 'cached'
  isAi: boolean
  // undefined when the source image carries no XMP metadata
  creditText?: string | undefined
  imageDescription?: string | undefined
}

export async function generateOgImage(
  page: Pick<Page, 'urlPath' | 'file' | 'metadata'>,
  source: ContentFile,
  destPath: string,
  stored: string, // where the image is kept between builds, of either kind
  cache: ImageCache,
  design: OgDesign,
  language: string,
): Promise<OgImageResult> {
  const srcPath = source.source
  const cacheKey = `og:${page.urlPath}${source.rel}`
  // everything the image is made of but its source and title: the design and the AI badge, if there is one
  const badge = await readFile(design.aiBadgePath).then(
    (bytes) => bytes.toString('base64'),
    () => undefined,
  )
  const configHash = createHash('sha256')
    .update(JSON.stringify([OG_CONFIG_HASH, design, language, badge ?? null]))
    .digest('hex')
  const sourceChanged = (await stat(srcPath)).ctimeMs
  // of the page, the image shows its title alone: a change of its text leaves the image as it is
  const title = page.metadata.title
  const cached = cache[cacheKey]

  if (cached && cached.sourceChanged === sourceChanged && cached.title === title && cached.configHash === configHash) {
    try {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(stored, destPath)
      return {
        result: 'cached',
        isAi: cached.isAi ?? false,
        creditText: cached.creditText,
        imageDescription: cached.imageDescription,
      }
    } catch {}
    // not in the store (`hadley clean`, or removed by hand) → made again
  }

  const endTurn = await pictureTurn()
  try {
    const bytes = await pictureBytes(srcPath)
    const meta = await sharp(bytes).metadata()
    const w = meta.width ?? 1
    const h = meta.height ?? 1

    await mkdir(dirname(destPath), { recursive: true })

    // portrait: cropped (cover, centre); landscape or square: contained and padded (see the top of the file)
    const isPortrait = w < h
    const baseImage = sharp(bytes)
      .timeout({ seconds: IMAGE_SECONDS })
      .resize(
        OG_WIDTH,
        OG_HEIGHT,
        isPortrait ? { fit: 'cover', position: 'centre' } : { fit: 'contain', background: OG_BG },
      )

    // Read source metadata once for AI-detection and XMP extraction
    const srcXmp = meta.xmp ?? null
    const ai = srcXmp ? /trainedAlgorithmicMedia/i.test(srcXmp.toString('utf-8')) : false
    const creditText = srcXmp
      ? (extractXmpText(srcXmp, 'photoshop:Credit') ?? extractXmpText(srcXmp, 'dc:creator'))
      : undefined
    const imageDescription = srcXmp ? extractXmpText(srcXmp, 'dc:description') : undefined

    if (ai && badge === undefined) throw new Error(`an AI-generated og image needs the badge ${design.aiBadgePath}`)
    const aiBadgeB64 = ai ? badge! : ''
    const { data, aspect, mime } = design.logo
    const overlay = buildOverlay(
      title,
      design.claims[language] ?? '',
      data,
      aspect,
      mime,
      aiBadgeB64,
      ai,
      design.background,
    )
    const jpegBuf = await baseImage
      .composite([{ input: overlay, blend: 'over' }])
      .jpeg({ quality: 85 })
      .toBuffer()
    if (ai && srcXmp) {
      await writeFile(destPath, injectJpegXmp(jpegBuf, stripAiPromptFromXmp(srcXmp)))
    } else {
      await writeFile(destPath, jpegBuf)
    }
    await mkdir(dirname(stored), { recursive: true })
    await copyFile(destPath, stored)

    cache[cacheKey] = {
      sourceChanged,
      title,
      configHash,
      naturalWidth: w,
      naturalHeight: h,
      validWidths: [OG_WIDTH],
      isAi: ai,
      creditText,
      imageDescription,
    }

    return { result: 'generated', isAi: ai, creditText, imageDescription }
  } finally {
    endTurn()
  }
}
