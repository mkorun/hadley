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

// the declarations of the first :root block, the first of a name counting; undefined without a stylesheet
async function rootTokens(siteDir: string): Promise<Map<string, string> | undefined> {
  const declared = new Map<string, string>()
  let css = ''
  try {
    css = await readFile(joinPath(siteDir, 'theme', 'assets', 'css', 'style.css'), 'utf-8')
  } catch {
    return undefined
  }

  const rootMatch = css.match(/:root\s*\{([^}]*)\}/)
  const rootBlock = rootMatch?.[1] ?? ''

  for (const [, name, value] of rootBlock.matchAll(/([-\w]+)\s*:\s*([^;]+);/g)) {
    if (!declared.has(name!)) declared.set(name!, value!.trim())
  }
  return declared
}

export async function readCssTokens(siteDir: string, names: string[]): Promise<Record<string, string | undefined>> {
  const declared = await rootTokens(siteDir)
  const result: Record<string, string | undefined> = {}
  if (!declared) return result
  for (const name of names) result[name] = declared.get(name)
  return result
}

/** Every token whose name begins with `prefix`, by the rest of its name (`--cover-doodle` → `doodle`). */
export async function readCssTokensStartingWith(siteDir: string, prefix: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [name, value] of (await rootTokens(siteDir)) ?? [])
    if (name.startsWith(prefix) && name.length > prefix.length) result[name.slice(prefix.length)] = value
  return result
}
