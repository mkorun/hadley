/**
 * The JSON-LD of a page (`html.jsonLd`): a home page's Person and WebSite, an article's or essay's BlogPosting;
 * nothing for any other page.
 */
import { jsonScript } from '../case/index.ts'
import { PROFILES } from './persons.ts'
import type { Language, Page } from './site.ts'

/** `ogImage` is the URL of the page's og image, as its head names it. */
export function jsonLd(page: Page, language: Language, lang: string, ogImage: string | undefined): string {
  const origin = language.origin

  if (page.template === 'home') {
    // the owner's person file, which config.lima names
    const ol = (language.ownerLinks ?? {}) as Record<string, string | undefined>
    const personId = `${origin}/#person`
    const sameAs = [ol.url, ...Object.keys(PROFILES).map((network) => ol[network])].filter(Boolean)
    const person: Record<string, unknown> = {
      '@type': 'Person',
      '@id': personId,
      name: ol.name,
      url: ol.url ?? origin,
      ...(ol.bio ? { description: ol.bio } : {}),
      ...(ol.photo ? { image: ol.photo.startsWith('/') ? origin + ol.photo : ol.photo } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    }
    const website: Record<string, unknown> = {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: origin,
      name: language.title,
      ...(language.description ? { description: language.description } : {}),
      publisher: { '@id': personId },
      inLanguage: lang,
      // a search engine may send a query to the search page of the language (?q=)
      ...(language.searchPage
        ? {
            potentialAction: {
              '@type': 'SearchAction',
              target: { '@type': 'EntryPoint', urlTemplate: `${origin}${language.searchPage}?q={search_term_string}` },
              'query-input': 'required name=search_term_string',
            },
          }
        : {}),
    }
    return jsonScript({ '@context': 'https://schema.org', '@graph': [person, website] })
  }

  const meta = page.metadata
  if (!page.articleLike || !meta.publishFrom) return ''
  const authorName = typeof meta.author === 'object' ? meta.author.name : meta.author
  const image =
    !page.ogImage && page.isAiOg
      ? {
          '@type': 'ImageObject',
          url: ogImage,
          digitalSourceType: 'https://schema.org/TrainedAlgorithmicMediaDigitalSource',
          ...(authorName ? { creator: { '@type': 'Person', name: authorName } } : {}),
          ...(page.ogCreditText ? { creditText: page.ogCreditText } : {}),
          ...(page.ogImageDesc ? { description: page.ogImageDesc } : {}),
        }
      : ogImage
  return jsonScript({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    datePublished: meta.publishFrom.toISOString(),
    ...(meta.updatedAt ? { dateModified: meta.updatedAt.toISOString() } : {}),
    ...(authorName ? { author: { '@type': 'Person', name: authorName } } : {}),
    publisher: { '@type': 'Organization', name: language.title, url: origin },
    ...(language.issn ? { isPartOf: { '@type': 'Blog', name: language.title, url: origin, issn: language.issn } } : {}),
    url: origin + page.urlPath,
    image,
    inLanguage: lang,
  })
}
