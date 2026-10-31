#!/usr/bin/env bun
/**
 * Keeps markup on its serializers: `packages/hadley/case/html.ts` for HTML (`startTag`, `escHtml`) and
 * `packages/hadley/lib/xml.ts` for XML and SVG (the sitemap, the feed, the og images).
 *
 *   bun scripts/check-html.ts
 *
 * In the code that writes what a build outputs or serves (CHECKED) it reports two patterns outside the serializers
 * and outside tests: an attribute value written by interpolation (`="${` or `='${`), and a `.replace` or
 * `.replaceAll` whose replacement is a template literal, where `$&` and similar patterns in a value would be expanded.
 * It is a tripwire for the usual ways, not a proof: concatenation or a line break passes it.
 *
 * Exit status: 0 nothing found, 1 patterns found, 2 git or a file could not be read.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** The code that writes what a build outputs or the dev server and the editor serve. */
export const CHECKED = [
  'packages/hadley/case/*.ts',
  'packages/hadley/lib/*.ts',
  'packages/hadley/index.ts',
  'packages/hadley/hadley.ts',
  'packages/hadley/addons/editor/*.ts',
]
const SERIALIZERS = new Set(['packages/hadley/case/html.ts', 'packages/hadley/lib/xml.ts'])

const INTERPOLATED_ATTR = /=["']\$\{/
const TEMPLATE_REPLACEMENT = /\.replace(?:All)?\([^,]*,\s*`/

/** Returns `line: message` for every line of `text` that breaks a rule. */
export function htmlFindings(text: string): string[] {
  const found: string[] = []
  text.split('\n').forEach((line, i) => {
    if (INTERPOLATED_ATTR.test(line)) found.push(`${i + 1}: attribute value by interpolation; use startTag`)
    if (TEMPLATE_REPLACEMENT.test(line)) found.push(`${i + 1}: template literal as replacement; use a function`)
  })
  return found
}

export function main(): number {
  const listed = spawnSync('git', ['ls-files', '-z', '--', ...CHECKED], { encoding: 'utf8', timeout: 30_000 })
  if (listed.status !== 0) {
    console.error(`check-html: git ls-files failed: ${listed.error?.message ?? listed.stderr}`)
    return 2
  }
  const files = listed.stdout.split('\0').filter((file) => file && !SERIALIZERS.has(file) && !file.includes('/tests/'))
  if (files.length === 0) {
    console.error('check-html: git lists no files to check')
    return 2
  }
  const report: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`check-html: cannot read ${file}: ${error instanceof Error ? error.message : error}`)
      return 2
    }
    for (const finding of htmlFindings(text)) report.push(`${file}:${finding}`)
  }
  if (report.length > 0) {
    console.log(`markup written outside ${[...SERIALIZERS].join(' and ')}:\n${report.join('\n')}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
