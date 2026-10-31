/**
 * The line in a page's file of what a problem is about (lib/problems.ts): a front matter field, or a node of its
 * Markanto, by the parser's annotation of it. None where neither says.
 */
import type { Page } from './site.ts'

/** The line of the front matter field `key` in `source`, the first that sets it at the top level. */
export function fieldLine(source: string, key: string | undefined): number | undefined {
  if (key === undefined) return undefined
  const lines = (source.startsWith('\uFEFF') ? source.slice(1) : source).split('\n')
  if (!/^<?!?---/.test(lines[0] ?? '')) return undefined
  for (let i = 1; i < lines.length && !/^--->?\s*$/.test(lines[i]!); i++) {
    if (lines[i]!.startsWith(`${key}:`)) return i + 1
  }
  return undefined
}

/** The line in the page's file of `node`, a node of its Markanto, whose parser counts after the front matter. */
export function nodeLine(page: Pick<Page, 'source' | 'doc'>, node: object): number | undefined {
  const start = page.doc.parsed.annotations?.forNode(node)?.range.start
  if (start === undefined) return undefined
  return page.source.slice(0, page.doc.baseOffset).split('\n').length - 1 + start.line
}
