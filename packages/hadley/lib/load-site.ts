/**
 * A site as the build sees it, read once: config.lima, every page of its content with what it is and where it appears
 * (lib/site.ts), its lists and navigations, and the theme's texts. A page's state, outputs and language are decided
 * here and nowhere else; what is wrong with a page is collected for the build to decide (lib/problems.ts).
 */
import { readFile } from 'node:fs/promises'
import { basename, join as joinPath } from 'node:path'
import util from '@mkorun/galley/util'
import { parseDocument, typographyText } from '../case/index.ts'
import { CONTENT_ROOTS, pageFiles, type PageFile } from './bundles.ts'
import { KNOWN_TYPES, STATES, readFrontMatter } from './front-matter.ts'
import type { Problem } from './problems.ts'
import {
  defaultLanguageOf,
  fieldSchema,
  languageRecord,
  readConfig,
  readLocales,
  readThemeSettings,
  readMetaFiles,
  underMaintenance,
  type FieldSchema,
} from './site-config.ts'
import { fieldLine } from './lines.ts'
import { fallingBehind, readSourceData, sourceFiles, sourcesOf } from './sources.ts'
import { resolvePersons } from './persons.ts'
import { urlPathProblem } from './site-paths.ts'
import type { Config, Language, Page, PageState, Site } from './site.ts'

/** What reading one page needs of the site. */
interface Reading {
  config: Config
  schema: FieldSchema
  partials: Record<string, unknown>
  defaultLanguage: string
  isPublish: boolean
  today: string // YYYY-MM-DD: a published page dated later is scheduled
}

/** The day of `date` where the build runs (YYYY-MM-DD): a page scheduled for a day appears from its midnight there. */
export const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// localServer: built for the local server (lib/site-config.ts, languageRecord)
const loadSite = async (siteDir: string, isPublish = false, localServer = false): Promise<Site> => {
  const partials = await readMetaFiles(siteDir)
  const config = await readConfig(siteDir, partials)
  const defaultLanguage = defaultLanguageOf(config)
  const theme = await readThemeSettings(siteDir, config)
  const reading: Reading = {
    config,
    schema: await fieldSchema(config),
    partials,
    defaultLanguage,
    isPublish,
    today: localDay(new Date()),
  }
  const site: Site = {
    config,
    defaultLanguage,
    content: {},
    translationMappings: {},
    unpublishedIds: {},
    locales: {},
    problems: [],
    skipped: 0,
    behind: [],
  }
  // the pages of other repositories, read as content of their root, and their data, which every language's templates
  // read as site.data (docs/sources.md)
  const sources = sourcesOf(config, siteDir).map((source) => ({ source, ...sourceFiles(source, siteDir) }))
  const data: Record<string, unknown> = {}
  for (const { source, dir } of sources) {
    const behind = fallingBehind(source)
    if (behind !== undefined) site.behind.push(behind)
    for (const [name, file] of Object.entries(source.data)) data[name] = readSourceData(source, name, file, dir)
  }

  // A language is set up when its first page is met; the default language always is, so its feed, llms.txt and og
  // design exist even before it has pages.
  const languageOf = (language: string): Language =>
    (site.content[language] ??= { ...languageRecord(config, language, localServer, theme), data })
  languageOf(defaultLanguage)

  for (const root of CONTENT_ROOTS) {
    const files = await pageFiles(joinPath(siteDir, 'content'), root, defaultLanguage)
    for (const { source, dir, problems } of sources) {
      if (source.root !== root) continue
      for (const file of await pageFiles(dir, root, defaultLanguage)) {
        const fields = source.pages[file.bundleId] ?? {}
        files.push({ ...file, fromSource: { name: source.name, fields, problems: problems[file.bundleId] ?? [] } })
      }
    }
    for (const file of files) {
      const language = languageOf(file.language)
      const { page, problems } = await readPage(file, root, reading)
      if (language.pages[page.id]) {
        throw new Error(`${file.file}: the id ${page.id} is ${language.pages[page.id]!.file}'s already`)
      }
      language.pages[page.id] = page
      linkVariants(page, language)
      if (file.collectionId && file.variant === null) {
        const collection = (language.collections[file.collectionId] ??= [])
        if (!collection.includes(file.bundleId)) collection.push(file.bundleId)
      }
      site.problems.push(...problems.map((problem) => ({ page, ...problem })))
    }
  }

  // the default language first, the others by name, whichever bundle met them first
  const [, ...others] = Object.keys(site.content)
  site.content = Object.fromEntries(
    [defaultLanguage, ...others.sort()].map((language) => [language, site.content[language]!]),
  )
  listPages(site)
  resolvePersons(site)
  for (const [name, language] of Object.entries(site.content)) {
    language.navigations = navigations(
      config,
      language,
      name === defaultLanguage ? undefined : site.content[defaultLanguage],
    )
  }
  site.locales = await readLocales(siteDir, Object.keys(site.content), defaultLanguage)

  // A publish build has only the pages it writes; links to the others are removed by unpublishedIds
  if (isPublish) {
    for (const { pages } of Object.values(site.content)) {
      for (const [id, page] of Object.entries(pages)) {
        if (page.published) continue
        delete pages[id]
        site.skipped++
      }
    }
  }
  // under maintenance, a publish build has the page @errors/[503] alone, in each of its languages (config.md)
  if (isPublish && underMaintenance(config)) {
    let kept = 0
    for (const { pages } of Object.values(site.content)) {
      for (const [id, page] of Object.entries(pages)) {
        if (page.bundleId === '503' && page.collections.includes('errors')) kept++
        else delete pages[id]
      }
    }
    if (kept === 0)
      throw new Error('config.lima: maintenance is on, but the site has no page @errors/[503] to show (site.md)')
    // what is wrong with a page it does not build keeps no site from going into maintenance
    const built = new Set(Object.values(site.content).flatMap(({ pages }) => Object.values(pages).map((p) => p.file)))
    site.problems = site.problems.filter((problem) => built.has(problem.page.file))
  }
  return site
}

/** One page: its document, its front matter read, and what it is and where it appears, decided once. */
async function readPage(
  file: PageFile,
  root: (typeof CONTENT_ROOTS)[number],
  { config, schema, partials, defaultLanguage, isPublish, today }: Reading,
): Promise<{ page: Page; problems: Omit<Problem, 'page'>[] }> {
  const { language, variant, bundleId, collectionId } = file
  const source = String(await readFile(file.file))
  // parsed once here; rendered once every page's metadata is known (lib/render-content.ts)
  const doc = parseDocument(source, {
    partials,
    aliases: schema.aliases,
    defaults: schema.defaults,
    bundlePath: file.bundleDir,
    lang: language,
  })
  // the fields config.lima gives a page of another repository, as if they stood in its front matter: by their names
  // or aliases, given twice when the file has them too, before the defaults of config.lima fill what is missing
  const given: Omit<Problem, 'page'>[] = []
  if (file.fromSource) {
    const own = parseDocument(source, { partials, aliases: schema.aliases, bundlePath: file.bundleDir, lang: language })
    for (const [spelled, value] of Object.entries(file.fromSource.fields)) {
      const key = spelled.normalize('NFC')
      const field = Object.hasOwn(schema.aliases, key) ? schema.aliases[key]! : key
      if (Object.hasOwn(own.metadata, field))
        given.push({ message: `the front matter field ${field} is given by sources in config.lima as well` })
      else doc.metadata[field] = value
    }
    for (const message of file.fromSource.problems) given.push({ message })
  }
  const front = readFrontMatter(doc.metadata, schema, file.file)
  const { metadata } = front

  // articles → article, essays → essay, notes → note, pages → page
  const type = front.type ?? root.replace(/s$/, '')
  const template =
    front.template ?? (config.templates as Record<string, string> | undefined)?.[root] ?? root.replace(/s$/, '')
  const slug = basename(file.file, '.md').replace(/^_/, '')
  const prefix = language !== defaultLanguage ? `/${language}` : ''
  // an error page's address is hadley's: a server and a host find it by its number (site.md, deploy.md)
  if (collectionId === 'errors' && front.urlPath !== undefined)
    throw new Error(
      `${file.file}: an error page takes no urlPath; its address is ${prefix}/errors/${bundleId}/ (site.md)`,
    )
  const urlPath = collectionId === 'errors' ? `${prefix}/errors/${bundleId}/` : (front.urlPath ?? `${prefix}/${slug}/`)
  const urlPathFault = urlPathProblem(urlPath)
  if (urlPathFault) throw new Error(`${file.file}: urlPath ${urlPath} ${urlPathFault}`)
  const status = front.status ?? 'published'
  if (!STATES.includes(status)) throw new Error(`${file.file}: status ${status} is not one of ${STATES.join(', ')}`)

  const problems: Omit<Problem, 'page'>[] = front.faults.map(({ message, field }) => {
    const line = fieldLine(source, field)
    return line === undefined ? { message } : { message, line }
  })
  problems.push(...given)
  if (!KNOWN_TYPES.has(type))
    problems.push({ message: `its type ${type} is not one of ${[...KNOWN_TYPES].join(', ')}` })
  // an undated article is listed first; that may be meant
  if (root !== 'pages' && variant === null && !metadata.publishFrom)
    problems.push({ message: 'has no publishFrom', hint: true })

  // A field with a template keeps its value as text in meta; the template makes its HTML (html.fields). A publishOnly
  // field is shown as text in the dev overlay instead (devFields).
  const htmlFields: Record<string, string> = {}
  const devFields: Record<string, string> = {}
  for (const [key, fieldTemplate] of Object.entries(schema.templates)) {
    const value = metadata[key]
    if (value == null) continue
    const data = (typeof value === 'object' ? value : { value: String(value) }) as Record<string, unknown>
    if (schema.publishOnly.has(key) && !isPublish) {
      devFields[key] = String(data.value ?? JSON.stringify(data))
      continue
    }
    // a field template's fault names the page and the field, as a page template's does (lib/write-pages.ts)
    try {
      htmlFields[key] = await fieldTemplate.render(data, util)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${file.file}: the field ${key}: ${message}`, { cause: error })
    }
  }

  // Title, subtitle, link text and description are plain text outside the document; each gets typography on its own.
  // A description renderContent() writes from the page's text is typographic already.
  if (config.typography?.enabled === true) {
    for (const key of ['title', 'subtitle', 'linktext', 'description'] as const) {
      const text = metadata[key]
      if (text) metadata[key] = typographyText(text, language)
    }
  }

  /**
   * What the page is and where it appears, decided here, once. Each language version of a page is decided on its own:
   * an English draft leaves the German page published and linked. Links to a page that is not linkable are removed
   * when publishing and marked in a dev build.
   */
  const publishDay = metadata.publishFrom?.toISOString().slice(0, 10)
  const state = (
    status === 'published' && publishDay !== undefined && publishDay > today ? 'scheduled' : status
  ) as PageState
  const articleLike = type === 'article' || type === 'essay'
  const html = type !== 'note'
  const linkable = html && state === 'published'
  const inSiteFiles = linkable && front.inSitemap && collectionId !== 'errors'
  const inLlms = articleLike ? linkable && front.inSitemap : inSiteFiles && template !== 'home'
  const page: Page = {
    id: variant !== null ? `${bundleId}_${variant}` : bundleId,
    bundleId,
    language,
    file: file.file,
    bundleDir: file.bundleDir,
    source,
    ...(file.fromSource ? { fromSource: file.fromSource.name } : {}),
    doc,
    template,
    type,
    articleLike,
    urlPath,
    state,
    published: state !== 'draft' && state !== 'seed' && state !== 'scheduled',
    linkable,
    unpublished: state !== 'published',
    outputs: {
      html,
      listed: isPublish ? linkable : html,
      // a page search engines are asked not to index is no URL the sitemap offers them; feed and search keep it
      sitemap: inSiteFiles && metadata.noindex !== true,
      feed: inSiteFiles && articleLike,
      llms: inLlms,
      // a twin of every page llms.txt lists, unless the page declines (docs/deploy.md)
      markdown: config.markdown?.enabled === true && inLlms && front.inMarkdown,
      search: inSiteFiles,
      indexed: html && state !== 'archived' && metadata.noindex !== true,
    },
    metadata,
    collections: collectionId ? [collectionId] : [],
    htmlFields,
    devFields,
  }
  if (variant !== null) page.mainArticle = bundleId
  if (type === 'essay' && !metadata.vgwort_pixel && (state === 'published' || state === 'scheduled')) {
    problems.push({ message: 'is an essay without a VG Wort pixel', hint: true })
  }
  // what the parser found wrong, with the line it is on, before what was found here
  const parsed = (doc.parseErrors ?? []).map((error) => {
    const line = error.start === undefined ? undefined : source.slice(0, error.start).split('\n').length
    return { message: error.message, ...(line !== undefined ? { line } : {}) }
  })
  return { page, problems: [...parsed, ...problems] }
}

/** Links a variant and its main article, whichever of the two the folders listed first. */
function linkVariants(page: Page, language: Language): void {
  if (page.mainArticle) {
    const main = language.pages[page.mainArticle]
    if (main) (main.variants ??= {})[page.id.slice(page.bundleId.length + 1)] = page.id
    return
  }
  const variants: Record<string, string> = {}
  for (const [id, other] of Object.entries(language.pages)) {
    if (other.mainArticle === page.id) variants[id.slice(page.bundleId.length + 1)] = id
  }
  if (Object.keys(variants).length > 0) page.variants = variants
}

/**
 * The listed pages of each language, and what they yield for the rest of the site: a listed page's language versions
 * are linked like any page, and its tags and category list it like a list. Every id hadley gives templates names a
 * listed page: a collection's pages and a page's variants as lists do.
 */
function listPages(site: Site): void {
  for (const [lang, language] of Object.entries(site.content)) {
    const { pages, listed, taxonomy, collections } = language
    const unpublished = (site.unpublishedIds[lang] = new Set())
    for (const [id, page] of Object.entries(pages)) {
      if (!page.linkable) unpublished.add(id)
      if (page.outputs.listed) listed[id] = page
    }
    for (const [id, page] of Object.entries(listed)) {
      ;(site.translationMappings[id] ??= {})[lang] = page.urlPath
      if (page.template === 'home') {
        if (language.home !== undefined)
          throw new Error(`language "${lang}" has two home pages, ${language.home} and ${page.urlPath}`)
        language.home = page.urlPath
      }
      if (page.template === 'search') {
        if (language.searchPage !== undefined)
          throw new Error(`language "${lang}" has two search pages, ${language.searchPage} and ${page.urlPath}`)
        language.searchPage = page.urlPath
      }
      for (const tag of page.metadata.tags ?? []) (taxonomy.tags[tag] ??= []).push(id)
      const category = page.metadata.category
      if (category) (taxonomy.categories[category] ??= []).push(id)
    }
    for (const [name, ids] of Object.entries(collections)) {
      collections[name] = ids.filter((id) => Object.hasOwn(listed, id))
    }
    for (const page of Object.values(pages)) {
      if (!page.variants) continue
      for (const [name, id] of Object.entries(page.variants)) {
        if (!Object.hasOwn(listed, id)) delete page.variants[name]
      }
    }
  }
}

/** A language's navigations from config.lima (navigations:): listed pages, else the default language's version. */
function navigations(config: Config, language: Language, fallback: Language | undefined): Language['navigations'] {
  const result: Language['navigations'] = {}
  for (const [name, ids] of Object.entries(config.navigations ?? {}) as [string, string[]][]) {
    const navigation: Language['navigations'][string] = (result[name] = [])
    for (const id of ids) {
      const page = language.pages[id] ?? fallback?.pages[id]
      if (!page) {
        console.warn(`⚠️  Nav "${name}" references unknown page id: "${id}"`)
        continue
      }
      // a navigation shows a listed page, whatever its templates do; the dev build marks the unpublished
      if (!page.outputs.listed) continue
      navigation.push({
        id,
        title: page.metadata.linktext ?? page.metadata.title,
        urlPath: page.urlPath,
        unpublished: page.unpublished,
      })
    }
  }
  return result
}

export default loadSite
