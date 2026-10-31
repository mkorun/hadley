#!/usr/bin/env bun
/**
 * Keeps the build's writes in the modules that write what the output plan claims (lib/output.ts), so a new module
 * cannot write past it unnoticed.
 *
 *   bun scripts/check-writes.ts
 *
 * In the code that builds and serves (CHECKED, tests aside) it reports every call that writes to the file system
 * (writeFile, copyFile, mkdir, rm, rename, symlink, Bun.write, write streams, sharp's toFile, Pagefind's writeFiles and
 * their kin) outside WRITERS, which names what
 * each module writes. It is a tripwire for the usual calls, not a proof: a write through another API passes it.
 *
 * Exit status: 0 nothing found, 1 calls found, 2 git or a file could not be read.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const CHECKED = [
  'packages/hadley/case/*.ts',
  'packages/hadley/lib/*.ts',
  'packages/hadley/index.ts',
  'packages/hadley/hadley.ts',
  'packages/hadley/addons/editor/*.ts',
]

/** The modules that write, and what. */
export const WRITERS: Record<string, string> = {
  'packages/hadley/index.ts': 'the site files the plan claims, meta.json, links.json and the caches in .hadley/',
  'packages/hadley/lib/build-files.ts': "the files of a page's bundle it copies, claimed as they are copied",
  'packages/hadley/lib/images.ts':
    "an image's derivatives, claimed as they are made, and their store in .hadley/cache/images",
  'packages/hadley/lib/theme-files.ts': "the theme's files the plan claims",
  'packages/hadley/lib/write-pages.ts': 'the pages the plan claims',
  'packages/hadley/lib/search.ts': 'the search index, in the directory pagefind/ the plan claims',
  'packages/hadley/lib/generate-og-image.ts': "a page's og image, claimed",
  'packages/hadley/lib/generate-og-default.ts': 'og-default.jpg, claimed, and its store in .hadley/cache/images',
  'packages/hadley/lib/dev-server.ts': 'the output directory it serves, made when missing',
  'packages/hadley/lib/dev-https.ts':
    "the directory of the certificate mkcert makes for --https, in the user configuration's",
  'packages/hadley/hadley.ts': "the command line's config, a site's dist link, and what `hadley clean` empties",
  'packages/hadley/lib/init.ts': 'a new site, in a directory that was empty or did not exist (hadley init)',
  'packages/hadley/lib/sources.ts': 'the bundles of the sources and their fetched clones, in .hadley/cache/sources/',
  'packages/hadley/addons/editor/plugin.ts': 'the content file whose block the editor changes',
}

const WRITE =
  /(?:^|[^\w$])(?:writeFile|writeFileSync|copyFile|copyFileSync|appendFile|appendFileSync|rename|renameSync|symlink|symlinkSync|cp|cpSync|rm|rmSync|unlink|unlinkSync|mkdir|mkdirSync|createWriteStream)\(|\.(?:toFile|writeFiles)\(|Bun\.write\(/

/** Returns `line: message` for every line of `text` that writes to the file system; comments are left out. */
export function writeFindings(text: string): string[] {
  const found: string[] = []
  text.split('\n').forEach((line, i) => {
    const code = line.trim()
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
    if (WRITE.test(line)) found.push(`${i + 1}: writes to the file system`)
  })
  return found
}

export function main(): number {
  const listed = spawnSync('git', ['ls-files', '-z', '--', ...CHECKED], { encoding: 'utf8', timeout: 30_000 })
  if (listed.status !== 0) {
    console.error(`check-writes: git ls-files failed: ${listed.error?.message ?? listed.stderr}`)
    return 2
  }
  const files = listed.stdout.split('\0').filter((file) => file && !(file in WRITERS) && !file.includes('/tests/'))
  if (files.length === 0) {
    console.error('check-writes: git lists no files to check')
    return 2
  }
  const report: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`check-writes: cannot read ${file}: ${error instanceof Error ? error.message : error}`)
      return 2
    }
    for (const finding of writeFindings(text)) report.push(`${file}:${finding}`)
  }
  if (report.length > 0) {
    console.log(`writes outside the modules scripts/check-writes.ts names (WRITERS):\n${report.join('\n')}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
