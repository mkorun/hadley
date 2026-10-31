/**
 * generate-og-default.ts
 *
 * Makes a site's og-default.jpg; the build (index.ts) calls generateOgDefault().
 * Layout: the logo and the claim (in two lines) large in the centre, the URL small at the bottom right.
 *
 * System requirement: fonts-noto-core (sudo apt install -y fonts-noto-core)
 */

import { createHash } from 'node:crypto'
import { access, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { OgDesign } from './og.ts'
import { element, xmlDocument, type XmlElement } from './xml.ts'

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const PAD = 44
const FONT = "'Noto Sans','DejaVu Sans',Arial,sans-serif"

const LOGO_H = 168
const TAGLINE_SIZE = 48

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

/**
 * Writes the site's og-default.jpg to `outputPath`. It depends on nothing but its picture, so the picture's hash names
 * it in `storeDir`, and a build whose picture is unchanged copies it from there instead of making it again.
 */
export async function generateOgDefault(design: OgDesign, outputPath: string, storeDir: string): Promise<void> {
  const BG = design.background
  const ACCENT = design.accent
  const logoB64 = design.logo.data
  const logoMime = design.logo.mime
  const logoAspect = design.logo.aspect
  const LOGO_W = Math.round(LOGO_H * logoAspect)

  const siteOrigin = design.origins[design.defaultLanguage] ?? ''
  const siteClaim = design.claims[design.defaultLanguage] ?? ''

  const logoX = Math.round((OG_WIDTH - LOGO_W) / 2)
  const logoY = Math.round(OG_HEIGHT * 0.32) // ≈ 202 px — slightly above center
  const CX = OG_WIDTH / 2 // 600 — horizontal center

  // A claim with " – " (an en dash) is set in two lines, broken there: "Software, tools, AI" / "– and the thinking
  // behind them"; both lines are underlined
  const LINE_GAP = 20
  const ACCENT_F1 = 0.54 // line 1: a little shorter than its text
  const ACCENT_F2 = 0.6 // line 2: a little longer than line 1
  const splitIdx = siteClaim.indexOf(' – ')
  const hasSplit = splitIdx !== -1
  const line1 = hasSplit ? siteClaim.slice(0, splitIdx) : siteClaim
  const line2 = hasSplit ? '– ' + siteClaim.slice(splitIdx + 3) : ''

  const line1Y = logoY + LOGO_H + 10 + TAGLINE_SIZE // baseline of line 1
  const line2Y = line1Y + TAGLINE_SIZE + LINE_GAP // baseline of line 2
  const textMidY = hasSplit ? (line1Y + line2Y) / 2 : line1Y - TAGLINE_SIZE / 2

  // an accent line under each line, as wide as its text
  const half1 = Math.round(TAGLINE_SIZE * ACCENT_F1 * (line1.length / 2)) - 18
  const half2 = hasSplit ? Math.round(TAGLINE_SIZE * ACCENT_F2 * (line2.length / 2)) - 41 : 0

  // the ends apart, so left and right can be set each on its own
  const acc1L = CX - half1 - 1
  const acc1R = CX + half1 + 4
  const acc2L = CX - half2 + 8
  const acc2R = CX + half2 - 3
  const accent1Y = line1Y + 14
  const accent2Y = line2Y + 12

  const logoCX = logoX + LOGO_W / 2
  const logoCY = logoY + LOGO_H / 2

  // Claim and origin are drawn in white over the background; the claim is underlined per line in the accent colour
  const text = (x: number, y: number, attrs: XmlElement['attrs'], value: string) =>
    element('text', [['x', `${x}`], ['y', `${y}`], ['font-family', FONT], ...attrs], value)
  const claimLine = (value: string, y: number, from: number, to: number, accentY: number) => [
    text(
      CX,
      y,
      [
        ['text-anchor', 'middle'],
        ['font-size', `${TAGLINE_SIZE}`],
        ['fill', 'white'],
        ['opacity', '0.7'],
      ],
      value,
    ),
    element('line', [
      ['x1', `${from}`],
      ['y1', `${accentY}`],
      ['x2', `${to}`],
      ['y2', `${accentY}`],
      ['stroke', ACCENT],
      ['stroke-width', '4'],
    ]),
  ]

  const layers: XmlElement[] = [
    element('rect', [
      ['width', `${OG_WIDTH}`],
      ['height', `${OG_HEIGHT}`],
      ['fill', BG],
    ]),
    element(
      'g',
      [['transform', `rotate(-1, ${logoCX}, ${logoCY})`]],
      element('image', [
        ['href', `data:${logoMime};base64,${logoB64}`],
        ['x', `${logoX}`],
        ['y', `${logoY}`],
        ['width', `${LOGO_W}`],
        ['height', `${LOGO_H}`],
      ]),
    ),
    element(
      'g',
      [['transform', `rotate(-2, ${CX}, ${textMidY})`]],
      ...claimLine(line1, line1Y, acc1L, acc1R, accent1Y),
      ...(hasSplit ? claimLine(line2, line2Y, acc2L, acc2R, accent2Y) : []),
    ),
  ]
  if (siteOrigin) {
    const attrs: XmlElement['attrs'] = [
      ['font-size', '24'],
      ['fill', 'white'],
      ['opacity', '0.45'],
      ['text-anchor', 'end'],
    ]
    layers.push(text(OG_WIDTH - PAD, OG_HEIGHT - PAD, attrs, siteOrigin))
  }
  const svg = xmlDocument(
    element(
      'svg',
      [
        ['xmlns', 'http://www.w3.org/2000/svg'],
        ['xmlns:xlink', 'http://www.w3.org/1999/xlink'],
        ['width', `${OG_WIDTH}`],
        ['height', `${OG_HEIGHT}`],
      ],
      ...layers,
    ),
  )

  const stored = join(
    storeDir,
    `og-default.${createHash('sha256').update(`${BG}\n${svg}`).digest('hex').slice(0, 16)}.jpg`,
  )
  if (
    await access(stored).then(
      () => true,
      () => false,
    )
  ) {
    await copyFile(stored, outputPath)
    return
  }
  await sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 3,
      background: hexToRgb(BG),
    },
  })
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(outputPath)
  await mkdir(storeDir, { recursive: true })
  await copyFile(outputPath, stored)
}
