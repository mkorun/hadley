/**
 * read-css-tokens.ts
 *
 * Reads plain custom-property values out of a site's :root block in
 * theme/assets/css/style.css — no CSS engine, just one regex over the
 * declaration list (the first declaration of a name counts). Values must be literal (a hex color, a keyword) —
 * var(...) references and functions like oklch() are not resolved,
 * since that would need a real CSS parser/cascade. A site that wants a
 * token read here declares it as a literal value, once, alongside its
 * other design tokens.
 */

import { readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'

export async function readCssTokens(siteDir: string, names: string[]): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {}
  let css = ''
  try {
    css = await readFile(joinPath(siteDir, 'theme', 'assets', 'css', 'style.css'), 'utf-8')
  } catch {
    return result
  }

  const rootMatch = css.match(/:root\s*\{([^}]*)\}/)
  const rootBlock = rootMatch?.[1] ?? ''

  const declared = new Map<string, string>()
  for (const [, name, value] of rootBlock.matchAll(/([-\w]+)\s*:\s*([^;]+);/g)) {
    if (!declared.has(name)) declared.set(name, value.trim())
  }
  for (const name of names) result[name] = declared.get(name)
  return result
}
