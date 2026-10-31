import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// load-site.ts does not export mergeLocale — this is a copy of the function for unit tests.
// When the implementation changes, this copy must be kept in step.
function mergeLocale(base: Record<string, any>, over: Record<string, any>): Record<string, any> {
  const result = { ...base }
  for (const [k, v] of Object.entries(over)) {
    result[k] =
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? { ...((base[k] as object) ?? {}), ...(v as object) }
        : v
  }
  return result
}

describe('mergeLocale', () => {
  test('returns base unchanged when over is empty', () => {
    const base = { nav: { back: 'Zurück' }, article: { readingTime: 'Min. Lesezeit' } }
    assert.deepEqual(mergeLocale(base, {}), base)
  })

  test('overwrites scalar top-level keys', () => {
    const base = { nav: 'de-nav' }
    const over = { nav: 'en-nav' }
    assert.deepEqual(mergeLocale(base, over), { nav: 'en-nav' })
  })

  test('merges nested objects shallowly (2 levels)', () => {
    const base = { nav: { back: 'Zurück', skipLink: 'Zum Inhalt' } }
    const over = { nav: { back: 'Back' } }
    assert.deepEqual(mergeLocale(base, over), { nav: { back: 'Back', skipLink: 'Zum Inhalt' } })
  })

  test('keys missing in over fall back to base', () => {
    const base = { nav: { back: 'Zurück' }, article: { readingTime: 'Min. Lesezeit' } }
    const over = { nav: { back: 'Back' } }
    const result = mergeLocale(base, over)
    assert.equal(result.article.readingTime, 'Min. Lesezeit')
  })

  test('adds new keys from over', () => {
    const base = { nav: { back: 'Zurück' } }
    const over = { search: { placeholder: 'Search …' } }
    const result = mergeLocale(base, over)
    assert.equal(result.nav.back, 'Zurück')
    assert.equal(result.search.placeholder, 'Search …')
  })

  test('treats arrays as scalar values (no merge)', () => {
    const base = { tags: ['a', 'b'] }
    const over = { tags: ['c'] }
    assert.deepEqual(mergeLocale(base, over), { tags: ['c'] })
  })

  test('treats null as a scalar value (no merge)', () => {
    const base = { section: { key: 'value' } }
    const over = { section: null }
    assert.deepEqual(mergeLocale(base, over), { section: null })
  })

  test('does not mutate base', () => {
    const base = { nav: { back: 'Zurück' } }
    const over = { nav: { back: 'Back' } }
    mergeLocale(base, over)
    assert.equal(base.nav.back, 'Zurück')
  })
})
