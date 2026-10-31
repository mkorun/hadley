import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { format, parse } from '@markantolang/parser'

import { extract } from '../../packages/hadley/case/index.ts'
import { CommonMarkImportLossError, enforceImportLossPolicy, importCommonMark } from '../commonmark.ts'

describe('explicit CommonMark import', () => {
  test('returns strict, byte-idempotent canonical Markanto', () => {
    const imported = importCommonMark('Heading\n=======\n\n[text][key]\n\n[key]: https://example.test\n')
    const parsed = parse(imported.markanto, { strict: true })
    assert.equal(parsed.status, 'ok')
    if (parsed.status !== 'ok') return
    const formatted = format(parsed.document)
    assert.equal(formatted.status, 'ok')
    if (formatted.status === 'ok') assert.equal(formatted.source, imported.markanto)
  })

  test('exposes all six diagnostic levels', () => {
    const triggers = [
      ['normalised', 'Heading\n=======\n', {}],
      ['resolved', '[text][key]\n\n[key]: https://example.test\n', {}],
      ['source-structure-loss', 'note[^n]\n\n[^n]: first\n\n    second\n', {}],
      ['semantic-degradation', '<div>literal</div>\n', { rawHtml: 'escape' }],
      ['content-dropped', '<script>discarded()</script>\n', {}],
      ['unrepresentable', 'kept\n\n> > > deep\nlazy\n\nkept too\n', {}],
    ] as const
    for (const [category, source, options] of triggers) {
      assert.equal(
        importCommonMark(source, options).diagnostics.some((item) => item.category === category),
        true,
      )
    }
  })

  test('hard loss fails by default and requires explicit opt-in', () => {
    const imported = importCommonMark('<script>discarded()</script>\n')
    assert.equal(imported.markanto, '\n')
    assert.throws(() => enforceImportLossPolicy(imported), CommonMarkImportLossError)
    assert.doesNotThrow(() => enforceImportLossPolicy(imported, 'allow'))
  })

  test('extract remains a native Markanto path with no CommonMark fallback', () => {
    const source = '[text][key]\n\n[key]: https://example.test\n'
    const native = extract(source, {})
    assert.ok(native.html.includes('<p>[text][key]</p>'))
    assert.ok(!native.html.includes('>text</a>'))
    assert.ok(importCommonMark(source).markanto.includes('[text](https://example.test)'))
  })
})
