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

// 2026-11-04: mko.run's articles named no author, and an AI image's creator was the article's author, whom the image
// need not have been made by
describe('the JSON-LD of an article', () => {
  const posting = (page: Partial<Page>, more: Partial<Language> = {}, og?: string) =>
    JSON.parse(
      jsonLd(
        { template: 'article', articleLike: true, urlPath: '/a/', ...page } as unknown as Page,
        language({ ownerLinks: { name: 'Owen Owner' }, ...more } as Partial<Language>),
        'en',
        og,
      ).replace(/^<script[^>]*>|<\/script>$/g, ''),
    )
  const metadata = (more: object = {}) => ({ title: 'A', publishFrom: new Date('2026-11-04'), ...more })

  it('names its author, else the site owner', () => {
    assert.equal(posting({ metadata: metadata({ author: { name: 'Ada' } }) } as Partial<Page>).author.name, 'Ada')
    assert.equal(posting({ metadata: metadata() } as Partial<Page>).author.name, 'Owen Owner')
    assert.equal(
      'author' in posting({ metadata: metadata() } as Partial<Page>, { ownerLinks: {} } as Partial<Language>),
      false,
    )
  })

  it("gives an AI-generated og image the creator its XMP names, not the article's author", () => {
    const page = {
      metadata: metadata({ author: { name: 'Ada' } }),
      isAiOg: true,
      ogCreator: 'Ines Image',
      ogCreditText: 'Ines Image / ChatGPT',
    }
    const image = posting(page as Partial<Page>, {}, 'https://test.example/a/og.jpg').image
    assert.equal(image.creator.name, 'Ines Image')
    assert.equal(image.creditText, 'Ines Image / ChatGPT')
    assert.equal(
      'creator' in
        posting({ ...page, ogCreator: undefined } as Partial<Page>, {}, 'https://test.example/a/og.jpg').image,
      false,
    )
  })
})
