/**
 * The site as lib/load-site.ts reads it: what each page is, where it appears and in which languages. Everything here
 * is decided once, when the site is loaded; the build reads it and decides none of it again.
 */
import type { Built, ParsedDocument, Picture, TocEntry } from '../case/index.ts'
import type { Problem } from './problems.ts'
import type { ContentFile } from './site-paths.ts'

/** config.lima, trusted like code (AGENTS.md, "Security"); read where it is used, not yet checked where it enters. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Config = Record<string, any>

/** A cover as an entry of a list holds it (docs/themes.md "Covers"): the picture as values, its paths from the root. */
export type ListCover = Pick<Picture, 'src' | 'width' | 'height' | 'sources'>

/** A theme's texts for one language (theme/i18n/<lang>.lima), `t` in templates. */
export type Locale = Record<string, unknown>

/** The front matter a page has once load-site checked the fields hadley reads; the rest belongs to the theme. */
export interface Metadata {
  // a page without one fails publishing; the dev build warns and shows it empty
  title: string
  subtitle?: string
  linktext?: string
  description?: string
  htmlTitle?: string
  publishFrom?: Date
  updatedAt?: Date
  tags?: string[]
  category?: string
  archetype?: string
  author?: string | { name?: string }
  vgwort_pixel?: string
  ai_assisted?: boolean // written with the help of AI
  noindex?: boolean
  [field: string]: unknown // one config.lima declares (metadata.<field>), for the theme
}

/**
 *   draft, seed  not written by a publish build
 *   scheduled    published, with a publishFrom still to come: not written by a publish build yet
 *   archived     written under its URL, linked and listed nowhere
 *   published    written, linked and listed
 */
export type PageState = 'draft' | 'seed' | 'scheduled' | 'archived' | 'published'

/**
 * What is written for a page and where it is listed. Lists, navigations, series, the links between language versions,
 * tags and categories show a `listed` page; the sitemap, the feed, llms.txt and the search index name a linkable page
 * that is not left out of the sitemap or an error page.
 */
export interface PageOutputs {
  html: boolean // a note has no page of its own yet
  listed: boolean // a publish build lists a linkable page, a dev build every page with its own, marked by its state
  sitemap: boolean
  feed: boolean
  llms: boolean
  markdown: boolean // has a Markdown twin
  search: boolean
  indexed: boolean // not archived and not `noindex`: search engines may index it
}

export interface Page {
  id: string // the bundle's id; a variant's is `<bundle id>_<variant>`
  bundleId: string
  language: string
  file: string
  bundleDir: string
  source: string // the file as read, for the editor's block ranges
  fromSource?: string // the source of a page of another repository (lib/sources.ts), which the editor leaves alone
  doc: ParsedDocument
  template: string
  type: string // article, essay, note or page
  articleLike: boolean // an article or an essay: dated, in the feed, with an og image
  urlPath: string
  state: PageState
  published: boolean // a publish build writes it: not a draft, a seed or scheduled
  linkable: boolean // a page may link it: it has a page of its own and its state is published
  unpublished: boolean // its state is not published; templates mark it
  outputs: PageOutputs
  metadata: Metadata
  collections: string[]
  mainArticle?: string // a variant's bundle (its comment thread), not a page to link
  variants?: Record<string, string> // by variant name, the listed ones
  htmlFields: Record<string, string> // the HTML of the fields config.lima gives a template
  devFields: Record<string, string> // a publishOnly field's value as text, in a dev build

  // filled by the build (index.ts) as it goes
  files?: ReadonlyMap<object, Built>
  cover?: ContentFile | undefined
  ogSource?: ContentFile | undefined
  ogImage?: string | undefined
  markup?: string
  result?: PageResult
  coverImageHtml?: string
  listCover?: ListCover // the cover as a list shows it (lib/page-context.ts)
  isAiCover?: boolean
  hasOgImage?: boolean
  isAiOg?: boolean
  ogCreditText?: string | undefined
  ogImageDesc?: string | undefined
}

/** What the rendered content of a page yields besides its markup. */
export interface PageResult {
  toc: TocEntry[]
  shortcodes: { id: number; type: string; href: string; text?: string }[]
  charCount: number
  externalLinks: string[]
  tldr?: string
}

export interface NavigationItem {
  id: string
  title: string
  urlPath: string
  unpublished: boolean
}

/** One language of the site; its templates see it as `site`, through lib/site-view.ts. */
export interface Language {
  origin: string
  title: string | undefined
  claim: string | undefined
  tagline: string | undefined
  description: string | undefined
  locale: string | undefined
  since: number | undefined
  navigations: Record<string, NavigationItem[]>
  packages: unknown[]
  editors: unknown[]
  data: Record<string, unknown> // the data of sources by their names (docs/sources.md, "Data")
  collections: Record<string, string[]> // by name, the ids of its listed pages
  taxonomy: { categories: Record<string, string[]>; tags: Record<string, string[]> } // ids of listed pages
  pages: Record<string, Page> // every page the build has
  listed: Record<string, Page> // the pages lists, navigations and templates show (PageOutputs.listed)
  home?: string // the URL path of its listed page with the home template
  searchPage?: string // the URL path of its listed page with the search template
  comments?: Record<string, unknown>
  search?: true
  rss?: true
  theme?: Record<string, unknown> // the theme's settings (theme/theme.lima), as config.lima `theme` sets them
  issn?: string
  email?: string
  emailMailto?: string
  ownerLinks?: Record<string, unknown> // the owner (site.owner) as the language reads it (lib/persons.ts)
}

export interface Site {
  config: Config
  defaultLanguage: string // config.lima `site.default.language`
  content: Record<string, Language> // the default language first, the others by name
  translationMappings: Record<string, Record<string, string>> // by page id and language, the URL path of a listed page
  unpublishedIds: Record<string, Set<string>> // by language, the pages a link may not reach
  locales: Record<string, Locale>
  problems: Problem[] // what is wrong with its pages, found while loading (lib/problems.ts)
  skipped: number // the pages a publish build leaves out: drafts, seeds, scheduled pages
  behind: string[] // a source whose checkout has newer commits of its pages (docs/sources.md, "Falling behind")
}
