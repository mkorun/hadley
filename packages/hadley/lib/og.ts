/**
 * The design of a site's og images, read once: off unless config.lima sets `og: enabled: true`. Then its claim in every
 * language and the tokens `--og-background` and `--og-accent` of its style.css are required, and a missing one stops
 * the build with all of them named; the site's logo (resolveLogoPath) stands in them where it has one, else its title.
 * `--og-background` is the ground of og-default.jpg and the shade under the title of a page's og image. A cover goes
 * through the colour matrix of its style first, where the theme gives one (lib/cover-matrices.ts). An AI-generated
 * image needs the theme's `assets/icons/ai-badge.svg`, which generateOgImage() asks for when it meets one.
 */

import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import type { CoverMatrices } from './cover-matrices.ts'
import { readCssTokens } from './read-css-tokens.ts'
import { resolveLogoPath } from './resolve-logo-path.ts'

/** What stands where a logo goes: the site's logo, or without one its title in the page's language. */
export type OgBrand = { logo: { data: string; mime: string; aspect: number } } | { name: string }

export interface OgDesign {
  logo: { data: string; mime: string; aspect: number } | undefined // data: base64; none when the site has none
  names: Record<string, string> // the site's title, by language
  background: string // #rrggbb
  accent: string
  claims: Record<string, string> // by language
  // by cover style: the colour matrix a cover of that style goes through (lib/cover-matrices.ts)
  coverMatrices: CoverMatrices
  origins: Record<string, string>
  defaultLanguage: string
  aiBadgePath: string
}

const HEX = /^#[0-9a-f]{6}$/i

export async function loadOgDesign(
  siteDir: string,
  config: { og?: { enabled?: unknown } },
  content: Record<string, { claim?: string | undefined; origin?: string; title?: string | undefined }>,
  defaultLanguage: string,
  coverMatrices: CoverMatrices,
): Promise<OgDesign | undefined> {
  if (config.og?.enabled !== true) return undefined
  const missing: string[] = []

  const logoPath = await resolveLogoPath(siteDir)
  let logo: OgDesign['logo']
  if (logoPath) {
    const meta = await sharp(logoPath).metadata()
    if (!meta.width || !meta.height) missing.push(`the size of the logo ${logoPath}`)
    else {
      logo = {
        data: (await readFile(logoPath)).toString('base64'),
        mime: logoPath.endsWith('.png') ? 'image/png' : 'image/svg+xml',
        aspect: meta.width / meta.height,
      }
    }
  }

  const tokens = await readCssTokens(siteDir, ['--og-background', '--og-accent'])
  for (const name of ['--og-background', '--og-accent']) {
    if (!HEX.test(tokens[name] ?? '')) missing.push(`${name} as #rrggbb in the :root of theme/assets/css/style.css`)
  }

  const claims: Record<string, string> = {}
  const origins: Record<string, string> = {}
  const names: Record<string, string> = {}
  for (const [language, site] of Object.entries(content)) {
    if (site.claim) claims[language] = site.claim
    else missing.push(`a claim for the language ${language}`)
    origins[language] = site.origin ?? ''
    if (site.title) names[language] = site.title
    else if (!logoPath)
      missing.push(
        `a logo (theme/assets/images/logo.svg or logo.png, or --og-logo) or a title for the language ${language}`,
      )
  }

  if (missing.length > 0) throw new Error(`og images are enabled in config.lima, but need ${missing.join(', ')}`)
  return {
    logo,
    names,
    background: tokens['--og-background']!,
    accent: tokens['--og-accent']!,
    claims,
    coverMatrices,
    origins,
    defaultLanguage,
    aiBadgePath: joinPath(siteDir, 'theme', 'assets', 'icons', 'ai-badge.svg'),
  }
}

/** The logo of the design, or the site's title in `language` where it has no logo. */
export const brandOf = (design: OgDesign, language: string): OgBrand =>
  design.logo ? { logo: design.logo } : { name: design.names[language] ?? design.names[design.defaultLanguage] ?? '' }
