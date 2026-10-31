#!/usr/bin/env bun
/**
 * Checks that every regular expression in the files git tracks is a literal in RE2 syntax (docs/typescript.md).
 *
 *   bun scripts/check-regex.ts
 *
 * oxc-parser finds every regex literal and every call of `RegExp`; scripts/re2check (Go, run through mise) parses
 * each literal with RE2. A `RegExp` built at run time is reported: its pattern cannot be checked.
 *
 * Exit status: 0 all patterns are RE2 literals, 1 some are not, 2 git, a file, the parser or Go failed.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseSync } from 'oxc-parser'

export type Pattern = { where: string; pattern: string; flags: string }

/** The regex literals of one source file, and where it calls `RegExp`. */
export function findPatterns(file: string, source: string): { patterns: Pattern[]; runtime: string[] } {
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0) throw new Error(`${file}: ${parsed.errors[0].message}`)
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length
  const patterns: Pattern[] = []
  const runtime: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    const n = node as Record<string, any>
    if (n.type === 'Literal' && n.regex) {
      patterns.push({ where: `${file}:${lineOf(n.start)}`, pattern: n.regex.pattern, flags: n.regex.flags })
    }
    if ((n.type === 'NewExpression' || n.type === 'CallExpression') && n.callee?.name === 'RegExp') {
      runtime.push(`${file}:${lineOf(n.start)}`)
    }
    for (const key of Object.keys(n)) if (key !== 'parent') visit(n[key])
  }
  visit(parsed.program)
  return { patterns, runtime }
}

export function main(): number {
  const listed = spawnSync('git', ['ls-files', '-z', '--', '*.ts', '*.js', '*.mjs'], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (listed.status !== 0) {
    console.error(`check-regex: git ls-files failed: ${listed.error?.message ?? listed.stderr}`)
    return 2
  }
  const patterns: Pattern[] = []
  const report: string[] = []
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    try {
      const found = findPatterns(file, readFileSync(file, 'utf8'))
      patterns.push(...found.patterns)
      report.push(...found.runtime.map((where) => `${where}: RegExp built at run time; use a literal`))
    } catch (error) {
      console.error(`check-regex: ${error instanceof Error ? error.message : error}`)
      return 2
    }
  }
  if (patterns.length === 0) {
    console.error('check-regex: no regular expressions found; the parser or the file list is wrong')
    return 2
  }
  const re2 = spawnSync('mise', ['exec', 'go', '--', 'go', 'run', 'scripts/re2check/main.go'], {
    input: JSON.stringify(patterns),
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (re2.status !== 0 && re2.status !== 1) {
    console.error(`check-regex: re2check failed: ${re2.error?.message ?? re2.stderr}`)
    return 2
  }
  report.push(...re2.stdout.split('\n').filter(Boolean))
  if (report.length > 0) {
    console.log(report.join('\n'))
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
