/**
 * What is wrong with a page, from any step of the build, as data, and the one place that decides what becomes of it:
 *
 *   publish build  every fault of a step stops the build, all of them listed; a hint is a warning
 *   dev build      a fault or a hint of a page it would publish is a warning, and the page is shown as it can be
 *   draft, seed    silent in either build: it is meant to be unfinished, and shows in its page what it can
 *
 * A fault is what makes the page wrong (a file it names and does not have, a field of the wrong kind, a URL it may not
 * have); a hint is what may well be meant (an essay without a VG Wort pixel).
 */
import type { Page } from './site.ts'

export interface Problem {
  page: Pick<Page, 'file' | 'state'>
  message: string
  line?: number // in the page's file, when the problem has one
  hint?: true
}

const shown = (problem: Problem) =>
  `${problem.page.file}${problem.line === undefined ? '' : `:${problem.line}`}: ${problem.message}`

/** The warnings of a step's problems; throws, for a publish build, with every fault among them. */
export function settle(problems: readonly Problem[], isPublish: boolean): string[] {
  const told = problems.filter((problem) => problem.page.state !== 'draft' && problem.page.state !== 'seed')
  const faults = isPublish ? told.filter((problem) => !problem.hint) : []
  if (faults.length > 0) throw new Error(`cannot publish:\n${faults.map(shown).join('\n')}`)
  return told.map(shown)
}
