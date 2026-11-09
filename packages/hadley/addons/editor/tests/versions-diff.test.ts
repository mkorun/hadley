import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CELLS, LINES, folded, lineDiff, marked, wordDiff } from '../browser/features/versions/diff.ts'

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

describe('the words of a changed line', () => {
  const show = (pieces: { text: string; changed: boolean }[] | undefined) =>
    pieces?.map((piece) => (piece.changed ? `[${piece.text}]` : piece.text)).join('')

  it('marks only the words that changed, one mark for a run, its spaces outside', () => {
    const pair = wordDiff(
      'This one is much longer and carries the inline marks a text uses.',
      'This one is longer and carries the inline marks that a text uses.',
    )
    assert.equal(show(pair?.out), 'This one is [much] longer and carries the inline marks a text uses.')
    assert.equal(show(pair?.in), 'This one is longer and carries the inline marks [that] a text uses.')
    assert.equal(show(wordDiff('a b c d', 'a x y d')?.in), 'a [x y] d')
  })

  it('marks nothing where the two lines share too little', () => {
    assert.equal(wordDiff('An entirely different sentence here.', 'Nothing alike at all, really.'), undefined)
  })

  it('pairs the lines of a run out with the lines in after them, and folds what stays', () => {
    const lines = marked(lineDiff('a\nold words here\nb', 'a\nnew words here\nb')!)
    assert.deepEqual(
      lines.map((line) => [line.kind, show(line.pieces) ?? line.text]),
      [
        ['same', 'a'],
        ['del', '[old] words here'],
        ['add', '[new] words here'],
        ['same', 'b'],
      ],
    )
    const kinds = folded(lineDiff('1\n2\n3\n4\n5\n6\n7\n8\n9', '1\n2\n3\n4\nV\n6\n7\n8\n9')!, 1).map((line) =>
      line.kind === 'gap' ? `…${line.count}` : line.kind,
    )
    assert.deepEqual(kinds, ['…3', 'same', 'del', 'add', 'same', '…3'])
  })
})
