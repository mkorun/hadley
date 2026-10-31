import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findPatterns } from '../check-regex.ts'

describe('findPatterns', () => {
  it('finds regex literals with their flags, but not a division', () => {
    const source = ['const a = x / 2 / y', "const b = s.replace(/\\/(?:a|b)$/gi, '')", 'const c = /[/]/u'].join('\n')
    assert.deepEqual(findPatterns('a.ts', source), {
      patterns: [
        { where: 'a.ts:2', pattern: '\\/(?:a|b)$', flags: 'gi' },
        { where: 'a.ts:3', pattern: '[/]', flags: 'u' },
      ],
      runtime: [],
    })
  })

  it('reports a RegExp built at run time, with or without new', () => {
    const source = ['const a = new RegExp(`${name}:`)', "const b = RegExp('x')"].join('\n')
    assert.deepEqual(findPatterns('a.ts', source).runtime, ['a.ts:1', 'a.ts:2'])
  })

  it('stops on a file it cannot parse', () => {
    assert.throws(() => findPatterns('a.ts', 'const ='), /a\.ts:/)
  })
})
