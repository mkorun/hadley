import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from '../../case/index.ts'
import { fieldLine, nodeLine } from '../lines.ts'

// review 2026-10-28 (C.5): a problem named its file, not its line
describe('the line of a problem', () => {
  const source = '---\ntitle: A\ncover: a.png\n---\n\nText.\n\nSee [x]($nowhere).\n'

  it('is the line of the front matter field it is about, at the top level only', () => {
    assert.equal(fieldLine(source, 'cover'), 3)
    assert.equal(fieldLine(source, 'nowhere'), undefined)
    assert.equal(fieldLine('title: A\n', 'title'), undefined)
  })

  it("is the line of the content's node, counted in the file", () => {
    const doc = parseDocument(source, {} as never)
    const paragraph = doc.parsed.document!.children[1] as { children: object[] }
    assert.equal(nodeLine({ source, doc }, paragraph.children[1]!), 8)
  })
})
