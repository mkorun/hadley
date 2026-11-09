import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CELLS, LINES, lineDiff } from '../browser/features/line-diff.ts'

const kinds = (before: string, after: string) =>
  lineDiff(before, after)?.map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : '='}${line.text}`)

describe('the comparison of two versions', () => {
  it('keeps what both share and marks the rest, line by line', () => {
    assert.deepEqual(kinds('a\nb\nc', 'a\nB\nc'), ['=a', '-b', '+B', '=c'])
    assert.deepEqual(kinds('a\nc', 'a\nb\nc'), ['=a', '+b', '=c'])
    assert.deepEqual(kinds('a\nb\nc', 'a\nc'), ['=a', '-b', '=c'])
    assert.deepEqual(kinds('same', 'same'), ['=same'])
    assert.deepEqual(kinds('', 'x'), ['-', '+x'])
    // a block moved: one line out, one line in
    assert.deepEqual(kinds('x\ny\nz', 'y\nz\nx'), ['-x', '=y', '=z', '+x'])
  })

  it('compares nothing it would need too much for', () => {
    assert.equal(lineDiff('a\n'.repeat(LINES + 1), 'a'), undefined)
    const side = Math.ceil(Math.sqrt(CELLS))
    const left = Array.from({ length: side }, (_, i) => `l${i}`).join('\n')
    const right = Array.from({ length: side }, (_, i) => `r${i}`).join('\n')
    assert.equal(lineDiff(left, right), undefined)
    // the same size with a small change is cheap: the shared start and end are not in the table
    const changed = left.replace('l5\n', 'L5\n')
    assert.equal(lineDiff(left, changed)?.filter((line) => line.kind !== 'same').length, 2)
  })
})
