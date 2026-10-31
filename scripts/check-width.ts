#!/usr/bin/env bun
/**
 * Reports Markdown lines and comment-only lines longer than 120 characters (ADR 0003) in the files git tracks.
 *
 *   bun scripts/check-width.ts
 *
 * Markdown: every line except table rows and the lines of a fenced code block, which a reader copies as they are.
 * TypeScript, JavaScript and Go: lines that hold only a comment — a line
 * starting with `//`, and every line of a block comment that starts its line. Code lines are left to the formatter.
 * Characters are counted as code points. The content of a starter (packages/hadley/starters/<name>/content/) is a
 * site's text, set as its author writes it, and is not checked.
 *
 * Exit status: 0 nothing too long, 1 lines too long, 2 git or a file could not be read.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const WIDTH = 120

/** A starter's content: a site's text, not the repository's. */
export const isContent = (path: string): boolean => /^packages\/hadley\/starters\/[^/]+\/content\//.test(path)

/** Returns the 1-based numbers of the lines in `text` that break the width rule for a file named `path`. */
export function overlongLines(path: string, text: string, width = WIDTH): number[] {
  const lines = text.split('\n')
  const tooLong = (line: string) => [...line].length > width
  const found: number[] = []
  if (path.endsWith('.md')) {
    let inCode = false
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) inCode = !inCode
      else if (!inCode && !line.startsWith('|') && tooLong(line)) found.push(i + 1)
    })
    return found
  }
  if (!/\.(ts|js|go)$/.test(path)) return found
  let inBlock = false
  lines.forEach((line, i) => {
    const trimmed = line.trimStart()
    const startsBlock = !inBlock && trimmed.startsWith('/*')
    const isComment = inBlock || startsBlock || trimmed.startsWith('//')
    if (isComment && tooLong(line)) found.push(i + 1)
    if (startsBlock) inBlock = !trimmed.slice(2).includes('*/')
    else if (inBlock && trimmed.includes('*/')) inBlock = false
  })
  return found
}

export function main(): number {
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.md', '*.ts', '*.js', '*.go'], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (listed.status !== 0) {
    console.error(`check-width: git ls-files failed: ${listed.error?.message ?? listed.stderr}`)
    return 2
  }
  const files = listed.stdout.split('\0').filter((file) => file && !isContent(file))
  if (files.length === 0) {
    console.error('check-width: git lists no files to check')
    return 2
  }
  const report: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      console.error(`check-width: cannot read ${file}: ${error instanceof Error ? error.message : error}`)
      return 2
    }
    for (const line of overlongLines(file, text)) report.push(`${file}:${line}`)
  }
  if (report.length > 0) {
    console.log(`longer than ${WIDTH} characters:\n${report.join('\n')}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
