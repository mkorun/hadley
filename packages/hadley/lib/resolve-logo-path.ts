/**
 * resolve-logo-path.ts
 *
 * Site logo for OG image generation. Priority:
 *   1. `--og-logo` design token in theme/assets/css/style.css :root — explicit
 *      override for when the header logo doesn't read well on the OG card's
 *      own background (same mechanism as --og-background/--og-accent, see
 *      read-css-tokens.ts). Value is a url(), resolved relative to theme/assets/,
 *      e.g. `--og-logo: url('/assets/images/logo-og.svg');`
 *   2. theme/assets/images/logo.svg, falling back to logo.png.
 *
 * Returns undefined if nothing resolves — callers already handle a missing
 * logo gracefully (skip the overlay, warn).
 */

import { join as joinPath } from 'node:path'
import { existsExactly } from './platform.ts'
import { readCssTokens } from './read-css-tokens.ts'

export async function resolveLogoPath(siteDir: string): Promise<string | undefined> {
  const tokens = await readCssTokens(siteDir, ['--og-logo'])
  const raw = tokens['--og-logo']
  if (raw) {
    const urlMatch = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*?))\s*\)$/.exec(raw)
    const relPath = (urlMatch ? (urlMatch[1] ?? urlMatch[2] ?? urlMatch[3]) : raw).replace(/^\/?assets\//, '')
    const candidate = joinPath(siteDir, 'theme', 'assets', relPath)
    if (existsExactly(joinPath(siteDir, 'theme', 'assets'), relPath)) return candidate
    console.warn(`--og-logo names a file that is missing: ${candidate}`)
  }

  for (const name of ['logo.svg', 'logo.png']) {
    if (existsExactly(joinPath(siteDir, 'theme', 'assets'), `images/${name}`))
      return joinPath(siteDir, 'theme', 'assets', 'images', name)
  }
  return undefined
}
