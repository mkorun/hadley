/**
 * The feeds (RSS 2.0) of a site when config.lima turns them on: one for each language with a page in the build, in
 * the language's root (`/feed.xml`, `/en/feed.xml`), with its dated articles (PageOutputs.feed), the newest first. A
 * page that shows a feed to a reader is the site's own, with a template that reads `feed` (lib/page-context.ts).
 */
import type { Page, Site } from './site.ts'
import { isoDay } from './sitemap.ts'
import { element, xmlDocument } from './xml.ts'

/** The languages that have a feed. */
export const feedLanguages = (site: Site): string[] =>
  site.config.rss?.enabled === true
    ? Object.keys(site.content).filter((lang) => Object.values(site.content[lang]!.pages).some((p) => p.outputs.html))
    : []

/** The URL path of the feed of `lang`. */
export const feedUrl = (site: Site, lang: string): string =>
  lang === site.defaultLanguage ? '/feed.xml' : `/${lang}/feed.xml`

// a feed dates an article by its day
const day = (page: Page): Date => new Date(isoDay(page.metadata.publishFrom)!)

/** The pages the feed of `lang` lists, the newest first. */
export function feedPages(site: Site, lang: string): Page[] {
  return Object.values(site.content[lang]!.pages)
    .filter((page) => page.outputs.feed && page.metadata.publishFrom)
    .sort((a, b) => day(b).getTime() - day(a).getTime())
}

export function feedXml(site: Site, lang: string): { text: string; count: number } {
  const language = site.content[lang]!
  const origin = language.origin
  const pages = feedPages(site, lang)
  const channel = element(
    'channel',
    [],
    element('title', [], language.title ?? origin),
    element('link', [], `${origin}/`),
    element('atom:link', [
      ['href', `${origin}${feedUrl(site, lang)}`],
      ['rel', 'self'],
      ['type', 'application/rss+xml'],
    ]),
    element('language', [], lang),
    ...pages.map((page) => {
      const link = `${origin}${page.urlPath}`
      return element(
        'item',
        [],
        element('title', [], page.metadata.title),
        element('link', [], link),
        element('guid', [['isPermaLink', 'true']], link),
        element('pubDate', [], day(page).toUTCString()),
        ...(page.metadata.description ? [element('description', [], page.metadata.description)] : []),
      )
    }),
  )
  const rss = element(
    'rss',
    [
      ['version', '2.0'],
      ['xmlns:atom', 'http://www.w3.org/2005/Atom'],
    ],
    channel,
  )
  return { text: xmlDocument(rss), count: pages.length }
}
