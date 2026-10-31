import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readingTimeMinutes } from '../page-context.ts'
import type { Page } from '../site.ts'

// The language of a page is where its file lies in the bundle (page.language), not a front matter field.
const article = (language: string, charCount: number, mainArticle?: string) =>
  ({ language, result: { charCount }, mainArticle, metadata: { title: 'T' } }) as unknown as Page

describe('readingTimeMinutes', () => {
  it('reads an English article at 1100 characters a minute, a German one at 1000', () => {
    assert.equal(readingTimeMinutes(article('en', 1650)), 2)
    assert.equal(readingTimeMinutes(article('en', 1600)), 1)
    assert.equal(readingTimeMinutes(article('de', 1600)), 2)
  })

  it('reads a variant of another article at 700 a minute, whatever its language', () => {
    assert.equal(readingTimeMinutes(article('en', 1400, 'main')), 2)
  })

  it('gives no minutes to an article without text and at least one to any other', () => {
    assert.equal(readingTimeMinutes(article('de', 0)), 0)
    assert.equal(readingTimeMinutes(article('de', 10)), 1)
  })
})
