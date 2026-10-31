#!/usr/bin/env bun
/**
 * Checks the relative links of the documentation (docs/, README.md): each names a file git tracks, and an anchor in a
 * Markdown file names one of its headings as GitHub and hadley both name it. hadley.sh builds its pages from these
 * files (private/docs/release-2027-plan.md, 3.0), so a link must lead where it leads on GitHub; the two make a
 * heading's id differently (`config.lima` is `configlima` on GitHub, `config-lima` in hadley), and an anchor only one
 * of them knows is a problem.
 *
 *   bun scripts/check-links.ts
 *
 * Exit status: 0 every link leads somewhere, 1 problems found, 2 git or a file could not be read.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

/** The documentation, as scripts/check-content.ts holds it to canonical Markanto. */
const DOCS = ['docs/*.md', 'docs/**/*.md', 'README.md']

/** `text` without its fenced code blocks, which hold no links nor headings; lines keep their place. */
export function withoutFences(text: string): string {
  let fence: string | undefined
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence === undefined && marker) {
        fence = marker[0]!.repeat(marker.length)
        return ''
      }
      if (fence !== undefined) {
        if (line.trim().startsWith(fence)) fence = undefined
        return ''
      }
      return line
    })
    .join('\n')
}

/** `text` without its code, blocks and spans, which hold no links; lines keep their place. */
export const withoutCode = (text: string): string => withoutFences(text).replace(/`+[^`\n]*`+/g, '')

/** The text of the headings of a Markdown file, in order, as a reader sees them. */
export function headings(text: string): string[] {
  return withoutFences(text)
    .split('\n')
    .flatMap((line) => {
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1]
      return heading === undefined ? [] : [plain(heading)]
    })
}

// a heading's text without its markup: code spans, links and emphasis (canonical Markanto writes it with *) keep
// their words
const plain = (heading: string): string =>
  heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*+([^*]+)\*+/g, '$1')

/** A heading's id as GitHub makes it (github-slugger): lower case, punctuation gone, each space a `-`. */
export const githubSlug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')

/** A heading's id as hadley makes it (case/markanto-native-renderer.ts, slugify). */
export const hadleySlug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section'

/**
 * The ids of `names`, by `slug`: a later heading of the same id gets a number, from `first` on (GitHub counts a
 * second `a` as `a-1`, hadley as `a-2`).
 */
export function ids(names: string[], slug: (heading: string) => string, first: number): Set<string> {
  const used = new Set<string>()
  for (const name of names) {
    const base = slug(name)
    let id = base
    for (let n = first; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
  }
  return used
}

/** The relative targets of the links and pictures of `text`, with their line. */
export function links(text: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = []
  for (const [index, line] of withoutCode(text).split('\n').entries()) {
    for (const match of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = match[1]!
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue
      found.push({ target, line: index + 1 })
    }
  }
  return found
}

/** What is wrong with the links of `file`; `tracked` holds the paths git tracks, `read` reads one of them. */
export function linkProblems(file: string, tracked: ReadonlySet<string>, read: (path: string) => string): string[] {
  const problems: string[] = []
  for (const { target, line } of links(read(file))) {
    const [path = '', anchor] = target.split('#', 2)
    const resolved = path === '' ? file : normalize(join(dirname(file), decodeURI(path))).replaceAll('\\', '/')
    if (!tracked.has(resolved) && ![...tracked].some((tracked) => tracked.startsWith(`${resolved}/`))) {
      problems.push(`${file}:${line}: ${target} names ${resolved}, which git does not track`)
      continue
    }
    if (anchor === undefined) continue
    if (!resolved.endsWith('.md')) {
      problems.push(`${file}:${line}: ${target} names an anchor in a file that is not Markdown`)
      continue
    }
    const names = headings(read(resolved))
    if (!ids(names, githubSlug, 1).has(anchor) || !ids(names, hadleySlug, 2).has(anchor))
      problems.push(
        `${file}:${line}: ${target}: #${anchor} is not the id of a heading of ${resolved} on both GitHub and hadley.sh`,
      )
  }
  return problems
}

export function main(): number {
  const listed = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', timeout: 30_000 })
  const docs = spawnSync('git', ['ls-files', '-z', '--', ...DOCS], { encoding: 'utf8', timeout: 30_000 })
  if (listed.status !== 0 || docs.status !== 0) {
    console.error(`check-links: git ls-files failed: ${listed.error?.message ?? docs.error?.message ?? listed.stderr}`)
    return 2
  }
  const tracked = new Set(listed.stdout.split('\0').filter(Boolean))
  const problems: string[] = []
  try {
    for (const file of docs.stdout.split('\0').filter(Boolean))
      problems.push(...linkProblems(file, tracked, (path) => readFileSync(path, 'utf8')))
  } catch (error) {
    console.error(`check-links: ${error instanceof Error ? error.message : error}`)
    return 2
  }
  if (problems.length > 0) {
    console.log(`links of the documentation that lead nowhere:\n${problems.join('\n')}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
