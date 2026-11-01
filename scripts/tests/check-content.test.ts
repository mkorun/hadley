import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkPage, firstDifference } from '../check-content.ts'

const page = (body: string, front = 'title: T\n') => `---\n${front}---\n${body}`

describe('checkPage', () => {
  it('passes a page whose text is canonical Markanto', () => {
    assert.equal(checkPage(page('# T\n\n**Strong** text.\n'), {}), undefined)
  })

  it('names the line of the file, front matter counted, where the text leaves the canonical form', () => {
    const finding = checkPage(page('# T\n\n__Strong__ text.\n'), {})
    assert.match(finding?.problem ?? '', /^line 6 differs from the canonical Markanto$/)
    assert.equal(finding?.canonical, page('# T\n\n**Strong** text.\n'))
  })

  it('reads the front matter with the starter’s meta files, and reports what Lima refuses', () => {
    const front = 'author: $(persons/odile)\n'
    assert.equal(checkPage(page('# T\n', front), { 'persons/odile': { name: 'Odile' } }), undefined)
    assert.match(checkPage(page('# T\n', 'a: [[1]]\n'), {})?.problem ?? '', /^front matter: /)
  })
})

describe('firstDifference', () => {
  it('is the first line that differs, 1-based', () => {
    assert.equal(firstDifference('a\nb\nc', 'a\nx\nc'), 2)
    assert.equal(firstDifference('a', 'a\nb'), 2)
  })
})
