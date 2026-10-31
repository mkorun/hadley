import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isContent, overlongLines } from '../check-width.ts'

const long = (prefix: string) => prefix + 'x'.repeat(130)

describe('overlongLines', () => {
  it('reports long Markdown lines but not table rows', () => {
    assert.deepEqual(overlongLines('a.md', ['short', long('text '), long('| cell ')].join('\n')), [2])
  })

  it('leaves the lines of a fenced code block as they are, and checks the text after it', () => {
    const text = ['```caddy', long('header '), '```', long('text '), '~~~', long('code '), '~~~'].join('\n')
    assert.deepEqual(overlongLines('a.md', text), [4])
  })

  it('counts code points, not bytes', () => {
    assert.deepEqual(overlongLines('a.md', 'ä'.repeat(120)), [])
    assert.deepEqual(overlongLines('a.md', 'ä'.repeat(121)), [1])
  })

  it('reports long line comments and every line of a block comment, but not code', () => {
    const text = [long('// '), long('const x = '), '/*', long('  no leading star '), '*/', long('const y = ')].join(
      '\n',
    )
    assert.deepEqual(overlongLines('a.ts', text), [1, 4])
  })

  it('does not take a glob in code for the start of a block comment', () => {
    const text = ["const g = 'lib/**/*.ts'", long('const z = ')].join('\n')
    assert.deepEqual(overlongLines('a.ts', text), [])
  })

  it('ends a one-line block comment on the same line', () => {
    assert.deepEqual(overlongLines('a.go', ['/* short */', long('var x = ')].join('\n')), [])
  })

  it('ignores other file types', () => {
    assert.deepEqual(overlongLines('a.json', long('')), [])
  })
})

describe('isContent', () => {
  it('is a starter content file, which the check leaves as its author wrote it', () => {
    assert.equal(isContent('packages/hadley/starters/hems/content/articles/[a]/a.md'), true)
    assert.equal(isContent('packages/hadley/starters/hems/config.lima'), false)
    assert.equal(isContent('docs/themes.md'), false)
  })
})
