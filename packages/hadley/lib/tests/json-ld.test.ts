import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jsonLd } from '../json-ld.ts'
import type { Language, Page } from '../site.ts'

const home = { template: 'home', metadata: {} } as unknown as Page
const language = (more: Partial<Language>) => ({ origin: 'https://test.example', title: 'Test', ...more }) as Language
const action = (html: string) =>
  JSON.parse(html.replace(/^<script[^>]*>|<\/script>$/g, ''))['@graph'][1].potentialAction

// review 2026-10-28 (starter): every site with search sent search engines to teblo.de's /suche/
describe('the JSON-LD of a home page', () => {
  it('sends a search to the search page of its language, and nowhere without one', () => {
    const search = action(jsonLd(home, language({ search: true, searchPage: '/de/suche/' }), 'de', undefined))
    assert.equal(search.target.urlTemplate, 'https://test.example/de/suche/?q={search_term_string}')
    assert.equal(action(jsonLd(home, language({ search: true }), 'de', undefined)), undefined)
  })
})
