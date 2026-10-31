#!/usr/bin/env bun
/**
 * Checks the templates of the themes in packages/hadley/themes/ and of the sites present in sites/ against the rule
 * the build applies to the templates it reads (lib/compile-templates.ts, rawProblems): every layout and partial,
 * including one no layout includes yet.
 *
 *   bun scripts/check-templates.ts
 *
 * Reads the sites, never builds them. Without sites/ (a clone of the repository alone) only the themes are checked.
 *
 * Exit status: 0 nothing found, 1 problems found, 2 a file could not be read.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rawProblems } from '../packages/hadley/lib/compile-templates.ts'

/** The template directories: each theme's in `themesDir`, each site's in `sitesDir`. */
const templateDirs = (sitesDir: string, themesDir: string): string[] => [
  ...(existsSync(themesDir)
    ? readdirSync(themesDir)
        .sort()
        .map((theme) => join(themesDir, theme, 'templates'))
    : []),
  ...(existsSync(sitesDir)
    ? readdirSync(sitesDir)
        .sort()
        .map((site) => join(sitesDir, site, 'theme', 'templates'))
    : []),
]

export function main(sitesDir = 'sites', themesDir = 'packages/hadley/themes'): number {
  const report: string[] = []
  for (const templates of templateDirs(sitesDir, themesDir)) {
    if (!existsSync(templates)) continue
    for (const file of readdirSync(templates, { recursive: true }).map(String).sort()) {
      if (!file.endsWith('.chase') && !file.endsWith('.sort')) continue
      const path = join(templates, file)
      let source: string
      try {
        source = readFileSync(path, 'utf8')
      } catch (error) {
        console.error(`check-templates: cannot read ${path}: ${error instanceof Error ? error.message : error}`)
        return 2
      }
      report.push(...rawProblems(source, path).map((problem) => `${path}: ${problem}`))
    }
  }
  if (report.length > 0) {
    console.log(`templates the build would refuse:\n${report.join('\n')}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
