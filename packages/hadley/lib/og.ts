/**
 * The design of a site's og images, read once: off unless config.lima sets `og: enabled: true`. Then the site's logo
 * (resolveLogoPath), its claim in every language and the tokens `--og-background` and `--og-accent` of its style.css
 * are required; a missing one stops the build with all of them named. `--og-background` is the ground of
 * og-default.jpg and the shade under the title of a page's og image. A token `--og-cover-<style>` gives a cover of that
 * coverStyle a colour matrix to go through first. An AI-generated image needs the theme's `assets/icons/ai-badge.svg`,
 * which generateOgImage() asks for when it meets one.
 */

import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { readCssTokens, readCssTokensStartingWith } from './read-css-tokens.ts'
import { resolveLogoPath } from './resolve-logo-path.ts'

export interface OgDesign {
  logo: { data: string; mime: string; aspect: number } // data: base64
  background: string // #rrggbb
  accent: string
  claims: Record<string, string> // by language
  // by cover style: the 4 × 5 colour matrix (as SVG's feColorMatrix takes it) a cover of that style goes through
  coverMatrices: Record<string, number[]>
  origins: Record<string, string>
  defaultLanguage: string
  aiBadgePath: string
}

const HEX = /^#[0-9a-f]{6}$/i

export async function loadOgDesign(
  siteDir: string,
  config: { og?: { enabled?: unknown } },
  content: Record<string, { claim?: string | undefined; origin?: string }>,
  defaultLanguage: string,
): Promise<OgDesign | undefined> {
  if (config.og?.enabled !== true) return undefined
  const missing: string[] = []

  const logoPath = await resolveLogoPath(siteDir)
  let logo: OgDesign['logo'] | undefined
  if (!logoPath) missing.push('a logo (theme/assets/images/logo.svg or logo.png, or --og-logo)')
  else {
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

  const coverMatrices: Record<string, number[]> = {}
  for (const [style, value] of Object.entries(await readCssTokensStartingWith(siteDir, '--og-cover-'))) {
    const numbers = value.split(/[\s,]+/).map(Number)
    if (numbers.length === 20 && numbers.every(Number.isFinite)) coverMatrices[style] = numbers
    else missing.push(`--og-cover-${style} as 20 numbers, a colour matrix as feColorMatrix takes it`)
  }

  const claims: Record<string, string> = {}
  const origins: Record<string, string> = {}
  for (const [language, site] of Object.entries(content)) {
    if (site.claim) claims[language] = site.claim
    else missing.push(`a claim for the language ${language}`)
    origins[language] = site.origin ?? ''
  }

  if (missing.length > 0 || !logo)
    throw new Error(`og images are enabled in config.lima, but need ${missing.join(', ')}`)
  return {
    logo,
    background: tokens['--og-background']!,
    accent: tokens['--og-accent']!,
    claims,
    coverMatrices,
    origins,
    defaultLanguage,
    aiBadgePath: joinPath(siteDir, 'theme', 'assets', 'icons', 'ai-badge.svg'),
  }
}
