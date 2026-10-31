import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { settle, type Problem } from '../problems.ts'
import type { PageState } from '../site.ts'

// The one place that decides what becomes of what is wrong with a page (lib/problems.ts).
const of = (state: PageState, message: string, more: Partial<Problem> = {}): Problem => ({
  page: { file: `${state}.md`, state },
  message,
  ...more,
})

describe('settle', () => {
  it('stops a publish build with every fault of the step, each with its file and line', () => {
    const problems = [
      of('published', 'a fault', { line: 3 }),
      of('archived', 'another'),
      of('published', 'a hint', { hint: true }),
    ]
    assert.throws(
      () => settle(problems, true),
      (error: Error) => {
        assert.equal(error.message, 'cannot publish:\npublished.md:3: a fault\narchived.md: another')
        return true
      },
    )
  })

  it('makes a hint a warning in a publish build', () => {
    assert.deepEqual(settle([of('published', 'a hint', { hint: true })], true), ['published.md: a hint'])
  })

  it('warns in a dev build about a page it would publish, faults and hints alike', () => {
    const problems = [of('published', 'a fault'), of('scheduled', 'a hint', { hint: true }), of('archived', 'x')]
    assert.deepEqual(settle(problems, false), ['published.md: a fault', 'scheduled.md: a hint', 'archived.md: x'])
  })

  it('is silent about a draft and a seed in either build', () => {
    const problems = [of('draft', 'a fault'), of('seed', 'a hint', { hint: true })]
    assert.deepEqual(settle(problems, false), [])
    assert.deepEqual(settle(problems, true), [])
  })
})
