#!/usr/bin/env bun
/**
 * Checks the content of the starters (packages/hadley/starters/<name>/content/, the pages git tracks) as hadley reads
 * it: the front matter is Lima, with the starter's meta files for its references, and the rest is Markanto in its
 * canonical form, the one form Markanto writes for each meaning (`**strong**`, not `__strong__`). Markanto knows no
 * front matter, so it sees only what follows it. The documentation (docs/, README.md) is held to the same form, as
 * hadley.sh builds its pages from it.
 *
 *   bun scripts/check-content.ts [--write]
 *
 * --write  writes the canonical form of what differs in place, the front matter as it is
 *
 * Exit status: 0 all canonical (or written), 1 problems found, 2 git or a file could not be read.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { checkCanonical } from '@markantolang/parser'
import { prepareDocument } from '../packages/hadley/case/prepare-document.ts'
import { readMetaFiles } from '../packages/hadley/lib/site-config.ts'

export type Finding = { problem: string; canonical?: string }

/** The documentation, which hadley.sh shows (private/docs/release-2027-plan.md, 3.0) and GitHub too. */
const DOCS = ['docs/*.md', 'docs/**/*.md', 'README.md']

/** The line of `text` where it first differs from `other`, 1-based. */
export function firstDifference(text: string, other: string): number {
  const a = text.split('\n')
  const b = other.split('\n')
  let line = 0
  while (line < a.length && a[line] === b[line]) line++
  return line + 1
}

/** What is wrong with a page `source`, whose front matter may reference `partials`; nothing for a canonical page. */
export function checkPage(source: string, partials: Record<string, unknown>): Finding | undefined {
  const { md, baseOffset, frontMatterErrors } = prepareDocument(source, { partials })
  if (frontMatterErrors) return { problem: frontMatterErrors.map((error) => error.message).join('; ') }
  // the line breaks right after the front matter separate it from the text and are no part of the text
  const separator = md.match(/^(?:\r?\n)*/)![0]
  const head = source.slice(0, baseOffset + separator.length)
  const text = md.slice(separator.length)
  const result = checkCanonical(text)
  if (result.status === 'canonical') return undefined
  if (result.status === 'noncanonical') {
    const before = head.split('\n').length - 1
    return {
      problem: `line ${before + firstDifference(text, result.canonical)} differs from the canonical Markanto`,
      canonical: head + result.canonical,
    }
  }
  return { problem: result.diagnostics.map((d) => d.message).join('; ') || `Markanto: ${result.status}` }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const write = args.includes('--write')
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'packages/hadley/starters/*/content/*.md', ...DOCS], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (listed.status !== 0) {
    console.error(`check-content: git ls-files failed: ${listed.error?.message ?? listed.stderr}`)
    return 2
  }
  const report: string[] = []
  const metaByStarter = new Map<string, Record<string, unknown>>()
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    const starter = file.split('/').slice(0, 4).join('/') // packages/hadley/starters/<name>
    const isDoc = !file.startsWith('packages/hadley/starters/')
    if (!isDoc && !metaByStarter.has(starter)) metaByStarter.set(starter, await readMetaFiles(starter))
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`check-content: cannot read ${file}: ${error instanceof Error ? error.message : error}`)
      return 2
    }
    const finding = checkPage(source, isDoc ? {} : metaByStarter.get(starter)!)
    if (!finding) continue
    if (write && finding.canonical !== undefined) {
      writeFileSync(file, finding.canonical)
      console.log(`${file}: written in its canonical form`)
    } else report.push(`${file}: ${finding.problem}`)
  }
  if (report.length > 0) {
    console.log(`content hadley would read differently:\n${report.join('\n')}\n(bun scripts/check-content.ts --write)`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(await main())
