/**
 * generate-og-default.ts
 *
 * Makes a site's og-default.jpg; the build (index.ts) calls generateOgDefault().
 * Layout: the logo, or the site's name where it has none, and the claim (in two lines) large in the centre, the URL
 * small at the bottom right. Straight and plain unless the theme sets `--og-accent` (a line under the claim) or
 * `--og-tilt` (the claim turned by it, the logo by half), as teblo.de does.
 *
 * System requirement: fonts-noto-core (sudo apt install -y fonts-noto-core)
 */

import { createHash } from 'node:crypto'
import { access, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { brandOf, type OgDesign } from './og.ts'
import { element, xmlDocument, type XmlElement } from './xml.ts'

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const PAD = 44
const FONT = "'Noto Sans','DejaVu Sans',Arial,sans-serif"

const LOGO_H = 168
const TAGLINE_SIZE = 48

// the claim's widest line may take this much of the image, Noto Sans set ≈ 0.54 em a character
const CLAIM_WIDTH = OG_WIDTH - 4 * PAD
const width = (line: string, size: number) => line.length * size * 0.54

/**
 * The claim in its lines: broken at " – " (an en dash) into "Software, tools, AI" / "– and the thinking behind them",
 * else, where it is wider than the image allows, at the space nearest its middle; set smaller only where a line is
 * still too wide.
 */
export function claimLines(claim: string): { line1: string; line2: string; dashed: boolean; size: number } {
  const dash = claim.indexOf(' – ')
  let line1 = claim
  let line2 = ''
  if (dash !== -1) [line1, line2] = [claim.slice(0, dash), '– ' + claim.slice(dash + 3)]
  else if (width(claim, TAGLINE_SIZE) > CLAIM_WIDTH) {
    const spaces = [...claim.matchAll(/ /g)].map((m) => m.index)
    const at = spaces.sort((a, b) => Math.abs(a - claim.length / 2) - Math.abs(b - claim.length / 2))[0]
    if (at !== undefined) [line1, line2] = [claim.slice(0, at), claim.slice(at + 1)]
  }
  const widest = Math.max(width(line1, TAGLINE_SIZE), width(line2, TAGLINE_SIZE))
  const size = widest > CLAIM_WIDTH ? Math.floor((TAGLINE_SIZE * CLAIM_WIDTH) / widest) : TAGLINE_SIZE
  return { line1, line2, dashed: dash !== -1, size }
}

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
  const brand = brandOf(design, design.defaultLanguage)
  // without a logo the site's name stands in its place, as large as fits the width (Noto Sans Bold: ≈ 0.62 em a
  // character)
  const NAME_SIZE =
    'logo' in brand ? 0 : Math.min(LOGO_H * 0.8, Math.floor((OG_WIDTH - 4 * PAD) / (brand.name.length * 0.62)))
  const LOGO_W = 'logo' in brand ? Math.round(LOGO_H * brand.logo.aspect) : 0

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
  const { line1, line2, dashed, size } = claimLines(siteClaim)
  const hasSplit = line2 !== ''

  const line1Y = logoY + LOGO_H + 10 + size // baseline of line 1
  const line2Y = line1Y + size + LINE_GAP // baseline of line 2
  const textMidY = hasSplit ? (line1Y + line2Y) / 2 : line1Y - size / 2

  // where the theme sets --og-accent, a line under each line, as wide as its text; a second line broken at a space is
  // drawn as the first
  const half1 = Math.round(size * ACCENT_F1 * (line1.length / 2)) - 18
  const half2 = !hasSplit
    ? 0
    : dashed
      ? Math.round(size * ACCENT_F2 * (line2.length / 2)) - 41
      : Math.round(size * ACCENT_F1 * (line2.length / 2)) - 18

  // the ends apart, so left and right can be set each on its own
  const acc1L = CX - half1 - 1
  const acc1R = CX + half1 + 4
  const acc2L = dashed ? CX - half2 + 8 : CX - half2 - 1
  const acc2R = dashed ? CX + half2 - 3 : CX + half2 + 4
  const accent1Y = line1Y + 14
  const accent2Y = line2Y + 12

  const logoCX = logoX + LOGO_W / 2
  const logoCY = logoY + LOGO_H / 2

  // Claim and origin are drawn in white over the background
  const text = (x: number, y: number, attrs: XmlElement['attrs'], value: string) =>
    element('text', [['x', `${x}`], ['y', `${y}`], ['font-family', FONT], ...attrs], value)
  const claimLine = (value: string, y: number, from: number, to: number, accentY: number) => [
    text(
      CX,
      y,
      [
        ['text-anchor', 'middle'],
        ['font-size', `${size}`],
        ['fill', 'white'],
        ['opacity', '0.7'],
      ],
      value,
    ),
    ...(ACCENT === undefined
      ? []
      : [
          element('line', [
            ['x1', `${from}`],
            ['y1', `${accentY}`],
            ['x2', `${to}`],
            ['y2', `${accentY}`],
            ['stroke', ACCENT],
            ['stroke-width', '4'],
          ]),
        ]),
  ]
  // a group turned by `angle` about (x, y), or one left as it is
  const turned = (angle: number, x: number, y: number) =>
    angle === 0 ? [] : ([['transform', `rotate(${angle}, ${x}, ${y})`]] as XmlElement['attrs'])

  const layers: XmlElement[] = [
    element('rect', [
      ['width', `${OG_WIDTH}`],
      ['height', `${OG_HEIGHT}`],
      ['fill', BG],
    ]),
    element(
      'g',
      turned(design.tilt / 2, logoCX, logoCY),
      'logo' in brand
        ? element('image', [
            ['href', `data:${brand.logo.mime};base64,${brand.logo.data}`],
            ['x', `${logoX}`],
            ['y', `${logoY}`],
            ['width', `${LOGO_W}`],
            ['height', `${LOGO_H}`],
          ])
        : text(
            CX,
            logoY + Math.round(LOGO_H * 0.75),
            [
              ['text-anchor', 'middle'],
              ['font-size', `${NAME_SIZE}`],
              ['font-weight', 'bold'],
              ['fill', 'white'],
            ],
            brand.name,
          ),
    ),
    element(
      'g',
      turned(design.tilt, CX, textMidY),
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
