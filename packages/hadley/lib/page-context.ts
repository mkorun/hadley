/**
 * What a page's template is given: its metadata, its lists, its links and the HTML hadley wrote for it (`html.*`, the
 * only values a template writes as HTML). Pure: everything it reads was decided before (lib/site.ts).
 */
import { hasCode } from '../case/index.ts'
import { jsonLd } from './json-ld.ts'
import type { Config, Language, Locale, Page, Site } from './site.ts'
import type { SiteView } from './site-view.ts'

export interface ContextOptions {
  site: Site
  view: SiteView // the page's language as its template sees it
  assets: Readonly<Record<string, string>>
  isPublish: boolean
  og: boolean // config.lima turns og images on
  comments: string | undefined // the bundle's _comments.html
  feed: { url: string; pages: Page[] } | undefined // the feed of the page's language, when config.lima turns feeds on
}

/** The page's og image: its own from the front matter, the one made for it, the site's, or none (og images off). */
export const ogImageUrl = (page: Page, language: Language, og: boolean): string | undefined => {
  if (page.ogImage) return page.ogImage
  if (page.hasOgImage) return language.origin + page.urlPath + 'og.jpg'
  return og ? language.origin + '/og-default.jpg' : undefined
}

const seriesData = (page: Page, language: Language) => {
  const result = []
  for (const collName of page.collections) {
    const ids = language.collections[collName]
    if (!ids || ids.length < 2) continue
    const items = ids
      .flatMap((id) => {
        const p = language.listed[id]
        if (!p) return []
        return [
          {
            title: p.metadata.title,
            urlPath: p.urlPath,
            isCurrent: p.urlPath === page.urlPath,
            unpublished: p.unpublished,
            publishFrom: p.metadata.publishFrom ?? null,
          },
        ]
      })
      .sort((a, b) => (a.publishFrom?.getTime() ?? 0) - (b.publishFrom?.getTime() ?? 0))
      .map((item, i) => ({ ...item, num: i + 1 }))
    if (items.length < 2) continue
    const currentNum = items.findIndex((item) => item.isCurrent) + 1
    result.push({ items, currentNum, total: items.length })
  }
  return result
}

/** Minutes to read an article: characters per minute by its language, fewer for a variant of another article. */
export const readingTimeMinutes = (page: Page): number => {
  const charCount = page.result?.charCount ?? 0
  if (charCount === 0) return 0
  const perMinute: Record<string, number> = { de: 1000, en: 1100 }
  const cpm = page.mainArticle ? 700 : (perMinute[page.language] ?? 1000)
  return Math.max(1, Math.round(charCount / cpm))
}

const i18nLabel = (label: unknown, lang: string): string | null => {
  if (!label) return null
  if (typeof label === 'string') return label
  if (typeof label === 'object') return (label as Record<string, string>)[lang] ?? null
  return null
}

const categoryLabel = (locale: Locale, category: string | undefined): string | undefined => {
  if (!category) return undefined
  return (locale.categories as Record<string, string> | undefined)?.[category] ?? category
}

// a listed article as a list shows it
const listEntry = (page: Page, locale: Locale) => ({
  urlPath: page.urlPath,
  title: page.metadata.title,
  subtitle: page.metadata.subtitle ?? '',
  description: page.metadata.description ?? '',
  publishFrom: page.metadata.publishFrom ?? '',
  updatedAt: page.metadata.updatedAt ?? '',
  isUpdated: !!page.metadata.updatedAt,
  displayDate: page.metadata.updatedAt ?? page.metadata.publishFrom ?? '',
  status: page.state,
  showBadge: page.unpublished,
  category: page.metadata.category ?? '',
  categoryLabel: categoryLabel(locale, page.metadata.category),
  cover: page.listCover ?? null,
  isAiCover: page.isAiCover ?? false,
})

const featured = (language: Language, lang: string, config: Config, locale: Locale) => {
  const featuredIds = new Set<string>()
  const items = []

  for (const entry of config.featured_articles ?? []) {
    const id: string = entry.id
    if (!id) continue
    const page = language.listed[id]
    if (!page) continue
    featuredIds.add(id)
    items.push({ ...listEntry(page, locale), label: i18nLabel(entry.label, lang), isSeries: false })
  }

  for (const entry of config.featured_series ?? []) {
    const id: string = entry.id
    if (!id) continue
    const collIds = language.collections[id]
    if (!collIds?.length) continue
    const latest = collIds
      .flatMap((cid) => {
        const page = language.listed[cid]
        return page?.metadata.publishFrom ? [{ cid, page, publishFrom: page.metadata.publishFrom }] : []
      })
      .sort((a, b) => b.publishFrom.getTime() - a.publishFrom.getTime())[0]
    if (!latest) continue
    featuredIds.add(latest.cid)
    items.push({ ...listEntry(latest.page, locale), label: i18nLabel(entry.label, lang), isSeries: true })
  }

  return { items, featuredIds }
}

/** The order of the home page's list (articleList): undated articles first, then the newest. */
const byListOrder = (a: Page, b: Page): number => {
  const aPublishFrom = a.metadata.publishFrom?.getTime() ?? null
  const bPublishFrom = b.metadata.publishFrom?.getTime() ?? null
  // effectiveSortDate: updatedAt, where set, before publishFrom
  const aDate = a.metadata.updatedAt?.getTime() ?? aPublishFrom
  const bDate = b.metadata.updatedAt?.getTime() ?? bPublishFrom
  // undated articles that are not archived come first
  const aUndatedActive = aPublishFrom === null && a.state !== 'archived'
  const bUndatedActive = bPublishFrom === null && b.state !== 'archived'
  if (aUndatedActive !== bUndatedActive) return aUndatedActive ? -1 : 1
  const aGroup1 = aPublishFrom !== null && a.state !== 'archived'
  const bGroup1 = bPublishFrom !== null && b.state !== 'archived'
  // Group 1 (dated seed/published/draft) before Group 2
  if (aGroup1 !== bGroup1) return aGroup1 ? -1 : 1
  if (aGroup1 && bGroup1) {
    // Group 1: effectiveSortDate descending
    return bDate! - aDate!
  } else {
    // Group 2: seed → draft → archived, within each: dated desc first, then undated
    const order: Record<string, number> = { seed: 0, draft: 1, archived: 2 }
    const sd = (order[a.state] ?? 99) - (order[b.state] ?? 99)
    if (sd !== 0) return sd
    if ((aDate !== null) !== (bDate !== null)) return aDate !== null ? -1 : 1
    if (aDate !== null && bDate !== null) return bDate - aDate
    return 0
  }
}

/** The listed articles of `language` in the order of the home page's list. */
const listedArticles = (language: Language) =>
  Object.values(language.listed)
    .filter((p) => p.articleLike)
    .sort(byListOrder)

/** The articles before (`newer`) and after (`older`) `page` in the order of the home page's list (docs/themes.md). */
const neighbours = (page: Page, language: Language, locale: Locale) => {
  const articles = page.articleLike ? listedArticles(language) : []
  const at = articles.indexOf(page)
  const near = (p: Page | undefined) => (at !== -1 && p ? listEntry(p, locale) : null)
  return { newer: near(articles[at - 1]), older: near(articles[at + 1]) }
}

const articleList = (language: Language, exclude: Set<string>, locale: Locale) =>
  listedArticles(language)
    .filter((p) => !exclude.has(p.id))
    .map((p, i, arr) => {
      const year = p.metadata.publishFrom?.getFullYear() ?? 0
      const prevYear = i > 0 ? (arr[i - 1]!.metadata.publishFrom?.getFullYear() ?? 0) : -1
      return {
        ...listEntry(p, locale),
        year,
        yearChanged: i === 0 || year !== prevYear,
        isDraft: p.state === 'draft' || p.state === 'seed',
      }
    })

const htmlTitle = (page: Page, language: Language): string => {
  if (page.metadata.htmlTitle) return page.metadata.htmlTitle
  if (page.template === 'home') return [language.title, language.claim].filter(Boolean).join(' · ')
  return page.metadata.title
}

const copyrightYear = (since: number | undefined): string => {
  const y = new Date().getFullYear()
  return since && since < y ? `${since}-${y}` : String(y)
}

export function pageContext(page: Page, options: ContextOptions): Record<string, unknown> {
  const { site, isPublish } = options
  const lang = page.language
  const language = site.content[lang]!
  const locale = site.locales[lang] ?? {}
  const isArticle = page.articleLike
  const home = page.template === 'home' ? featured(language, lang, site.config, locale) : null
  const ogImage = ogImageUrl(page, language, options.og)
  const toc = (page.result?.toc ?? []).filter((e) => e.level === 2)
  const context: Record<string, unknown> = {
    meta: {
      ...page.metadata,
      // what hadley sets itself, which no page sets (lib/load-site.ts)
      lang,
      charset: 'utf-8',
      id: page.mainArticle ?? page.id, // bundle ID for comment form + other uses
      ...(page.outputs.indexed ? {} : { noindex: true }),
    },
    status: page.state,
    isDraft: page.state === 'draft' || page.state === 'seed',
    showBadge: page.unpublished,
    isUpdated: !!page.metadata.updatedAt,
    isArticle,
    isDevBuild: !isPublish,
    assets: options.assets,
    htmlTitle: htmlTitle(page, language),
    canonicalUrl: language.origin + page.urlPath,
    markdownUrl: page.outputs.markdown ? language.origin + page.urlPath + 'index.html.md' : null,
    ogImage,
    copyrightYear: copyrightYear(language.since),
    readingTimeMinutes: isArticle ? readingTimeMinutes(page) : 0,
    seriesData: isArticle ? seriesData(page, language) : [],
    featuredList: home?.items ?? [],
    articleList: home ? articleList(language, home.featuredIds, locale) : [],
    ...neighbours(page, language, locale),
    navigations: language.navigations,
    // the feed of the page's language: its URL path and its articles as a list shows them
    feed: options.feed && { url: options.feed.url, items: options.feed.pages.map((p) => listEntry(p, locale)) },
    t: locale,
    site: options.view,
    categoryLabel: categoryLabel(locale, page.metadata.category),
    urlPath: page.urlPath,
    translations: site.translationMappings[page.id], // by language, this page's URL path, its own language too
    hasTranslations: Object.keys(site.translationMappings[page.id] ?? {}).length > 1,
    template: page.template,
    type: page.type,
    collections: page.collections,
    charCount: page.result?.charCount ?? 0,
    devFields: !isPublish ? page.devFields : {},
    toc,
    hasToc: toc.length > 2,
    // a template links syntax-highlighting.css where it is needed (docs/highlighting.md)
    hasCode: hasCode(page.doc),
    mainArticle: page.mainArticle ?? null,
    isAiCover: page.isAiCover ?? false,
    // the page's own cover as values, as an entry of a list holds it (docs/themes.md "Covers")
    cover: page.listCover ?? null,
    // the only values a template writes as HTML ({@raw html.…}); everything else it escapes
    html: {
      markup: page.markup,
      jsonLd: jsonLd(page, language, lang, ogImage),
      cover: page.coverImageHtml ?? null,
      comments: options.comments ?? null,
      tldr: page.result?.tldr ?? null,
      fields: page.htmlFields,
    },
  }
  // read only by a template that links the home page; a language without one stops that template
  Object.defineProperty(context, 'homeUrl', {
    enumerable: true,
    get() {
      if (language.home === undefined) throw new Error(`homeUrl: language "${lang}" has no page with the home template`)
      return language.home
    },
  })
  return context
}
