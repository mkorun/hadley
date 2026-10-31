/**
 * The design of a site's og images, read once: off unless config.lima sets `og: enabled: true`. Then the site's logo
 * (resolveLogoPath), its claim in every language and the tokens `--og-background` and `--og-accent` of its style.css
 * are required; a missing one stops the build with all of them named. `--og-background` is the ground of
 * og-default.jpg and the shade under the title of a page's og image. An AI-generated image needs the theme's
 * `assets/icons/ai-badge.svg`, which generateOgImage() asks for when it meets one.
 */

import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { readCssTokens } from './read-css-tokens.ts'
import { resolveLogoPath } from './resolve-logo-path.ts'

export interface OgDesign {
  logo: { data: string; mime: string; aspect: number } // data: base64
  background: string // #rrggbb
  accent: string
  claims: Record<string, string> // by language
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
    origins,
    defaultLanguage,
    aiBadgePath: joinPath(siteDir, 'theme', 'assets', 'icons', 'ai-badge.svg'),
  }
}
