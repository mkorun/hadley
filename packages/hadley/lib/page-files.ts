/**
 * The files of every page, built or claimed before any page renders: the files its content and front matter name,
 * its cover and its og image. Each is claimed in the output plan (lib/output.ts) as `page <lang>/<id>: <what>`; the
 * site paths a page names are checked once the plan holds every file (checkSitePaths).
 */
import { join as joinPath } from 'node:path'
import { fileRequests, pictureHtml, type FileRequest } from '../case/index.ts'
import { buildPageFiles, frontMatterFiles, sitePaths, type Failure } from './build-files.ts'
import { buildCover, derivativeOwner, type AiLabels, type ImageCache, type ImageConfigs } from './images.ts'
import { generateOgImage } from './generate-og-image.ts'
import type { OgDesign } from './og.ts'
import type { Output } from './output.ts'
import { fieldLine, nodeLine } from './lines.ts'
import type { Problem } from './problems.ts'
import { renderOptions } from './render-content.ts'
import type { Page, Site } from './site.ts'

/**
 * What a page names its own files from: nothing, beside it, as a page is read at its own URL path; an error page's
 * URL path, as the server shows it at any address that fails (deploy.md), where a name beside it would lead nowhere.
 */
const pageBase = (page: { collections: string[]; urlPath: string }): string =>
  page.collections.includes('errors') ? page.urlPath : ''

/** The owner of a page's HTML in the output plan; its files are `<owner>: <what>`. */
export const pageOwner = (page: Page) => `page ${page.language}/${page.id}`

export interface FilesOptions {
  site: Site
  siteDir: string
  imageConfigs: (template: string) => ImageConfigs // a template's image configs, none without
  output: Output
  imageCache: ImageCache
  og: OgDesign | undefined
  isPublish: boolean
}

// how many were made and taken from the cache, and the pages whose image could not be made
type Counted = { built: number; cached: number; problems: Problem[] }

const why = (error: unknown) => (error instanceof Error ? error.message : String(error))

const placeFor = (output: Output, page: Page) => (name: string, what: string) =>
  output.claim(page.urlPath.slice(1) + name, `${pageOwner(page)}: ${what}`)

// the derivatives of a page's images, kept for the next build of either kind (.hadley/cache/images/<urlPath>)
const storeOf = (options: FilesOptions, page: Page) =>
  joinPath(options.siteDir, '.hadley', 'cache', 'images', page.urlPath)

/** What each page's content names, kept for checkSitePaths. */
export type PageRequests = ReadonlyMap<Page, readonly FileRequest[]>

/**
 * Builds the files every page's content and front matter name (lib/build-files.ts); fills `page.files`,
 * `page.cover`, `page.ogSource` and `page.ogImage`. Returns what it could not build, what each page named, and how
 * many images it made and took from the store.
 */
export async function buildFiles(
  options: FilesOptions,
): Promise<{ problems: Problem[]; requests: PageRequests; images: { built: number; cached: number } }> {
  const { site, output, isPublish } = options
  const problems: Problem[] = []
  const images = { built: 0, cached: 0 }
  // what each page's content names, kept for the site paths its links name
  const pageRequests = new Map<Page, FileRequest[]>()

  // every page's names claimed in the order of the site, as the conflicts the plan finds name them, while what
  // they name is still being written; their problems in the same order
  const pages: { page: Page; problems: Problem[]; done: Promise<void> }[] = []
  for (const [lang, language] of Object.entries(site.content)) {
    const image = site.locales[lang]?.image as Record<string, string> | undefined
    const aiLabels: AiLabels | undefined = image?.aiGenerated
      ? { badge: image.aiGenerated, altSuffix: image.aiGeneratedAlt ?? `(${image.aiGenerated})` }
      : undefined
    for (const page of Object.values(language.pages)) {
      const pageProblems: Problem[] = []
      // a template without image configs still goes through: a page with images then fails like any missing image
      const imageConfig = options.imageConfigs(page.template)
      const named = await frontMatterFiles(page, language.origin)
      for (const failure of named.failures) pageProblems.push(problemOf(page, failure))
      // a cover is built for what uses it: the template's cover (a "cover" image config) or the og image made from it
      if (named.cover && !imageConfig.cover && !(options.og && page.articleLike)) {
        const message = `cover ${named.cover.rel} is used nowhere: the template ${page.template} has no "cover" image config, and no og image is made for this page`
        pageProblems.push(problemOf(page, { message, field: 'cover' }))
      }
      // an og:image that names a file of the bundle is built with the files the content names
      const ogNode = {}
      const ogRequest = named.ogFile ? [{ node: ogNode, kind: 'copy' as const, ...named.ogFile }] : []
      const requests = [...fileRequests(page.doc, renderOptions(site, page, isPublish)), ...ogRequest]
      pageRequests.set(page, requests)
      const { written } = await buildPageFiles(
        page,
        requests,
        imageConfig,
        {
          place: placeFor(output, page),
          urlPath: page.urlPath,
          store: storeOf(options, page),
          base: pageBase(page),
        },
        options.imageCache,
        aiLabels,
      )
      const done = written.then((files) => {
        for (const failure of files.failures) pageProblems.push(problemOf(page, failure))
        images.built += files.images.built
        images.cached += files.images.cached
        const ogFile = files.files.get(ogNode)
        // the og image is made from the cover or the first image
        page.files = files.files
        page.cover = named.cover
        page.ogSource = named.cover ?? files.firstImage
        // beside the page, or on an error page a path of the site already (pageBase)
        page.ogImage =
          ogFile?.kind === 'file' ? new URL(ogFile.href, language.origin + page.urlPath).href : named.ogImage
      })
      pages.push({ page, problems: pageProblems, done })
    }
  }
  await Promise.all(pages.map(({ done }) => done))
  for (const { problems: pageProblems } of pages) problems.push(...pageProblems)

  return { problems, requests: pageRequests, images }
}

/** A failure as a problem of the page, with the line of the node or field it is about when there is one. */
function problemOf(page: Page, { message, node, field }: Failure): Problem {
  const line = node === undefined ? fieldLine(page.source, field) : nodeLine(page, node)
  return line === undefined ? { page, message } : { page, message, line }
}
/**
 * Checks the site paths every page names against the plan, once it holds every file the build writes; `renamed`
 * maps a file to the name it is written under (a fingerprinted theme file, the syntax stylesheet). Adds what they
 * name to `page.files`; returns those that name nothing the site writes.
 */
export function checkSitePaths(
  options: FilesOptions,
  requests: PageRequests,
  renamed: ReadonlyMap<string, string>,
): Problem[] {
  const problems: Problem[] = []
  for (const [page, named] of requests) {
    const paths = sitePaths(named, (rel) => options.output.writesFile(rel), renamed)
    for (const failure of paths.failures) problems.push(problemOf(page, failure))
    if (paths.files.size > 0) page.files = new Map([...(page.files ?? []), ...paths.files])
  }
  return problems
}

/**
 * Builds the cover of every page whose template shows one (a "cover" image config); fills `page.coverImageHtml` and
 * `page.listCover`.
 */
export async function buildCovers(options: FilesOptions): Promise<Counted> {
  const results = await Promise.all(
    Object.values(options.site.content).flatMap((language) =>
      Object.values(language.pages).map(async (page) => {
        const cover = page.cover
        if (!cover) return null
        // Without a "cover" image config the template shows no cover; the cover still serves the og:image.
        const coverConfig = options.imageConfigs(page.template).cover
        if (!coverConfig) return null
        const place = placeFor(options.output, page)
        let coverResult: Awaited<ReturnType<typeof buildCover>>
        try {
          coverResult = await buildCover(
            cover,
            coverConfig,
            (name) => place(name, derivativeOwner(cover.rel, coverConfig)),
            page.urlPath,
            options.imageCache,
            storeOf(options, page),
            pageBase(page),
          )
        } catch (error) {
          return { page, message: `cover ${cover.rel} could not be built: ${why(error)}` }
        }
        page.coverImageHtml = pictureHtml(
          coverResult.picture,
          '',
          [
            ['loading', 'eager'],
            ['fetchpriority', 'high'],
            ['decoding', 'async'],
          ],
          [['data-ai-generated', coverResult.isAiGenerated || undefined]],
        )
        page.listCover = coverResult.listCover
        page.isAiCover = coverResult.isAiGenerated
        return coverResult.fromCache ? 'cached' : 'generated'
      }),
    ),
  )
  return count(results)
}

// a page's og image: of an article or essay, from its cover or first image, when og images are on
const ogImageOf = (options: FilesOptions, page: Page) =>
  options.og && page.articleLike && page.ogSource ? page.ogSource : undefined

/** Claims the og image of every page that gets one (buildOgImages makes it once the page's text is known). */
export function planOgImages(options: FilesOptions): void {
  for (const language of Object.values(options.site.content))
    for (const page of Object.values(language.pages))
      if (ogImageOf(options, page)) placeFor(options.output, page)('og.jpg', 'og image')
}

/**
 * Makes the og image (1200×630) of every article and essay from its cover or first image when og images are on;
 * fills what its head and JSON-LD say of it. Portrait → crop (cover), landscape/square → pad (contain + #fcfcfc).
 */
export async function buildOgImages(options: FilesOptions): Promise<Counted> {
  const design = options.og
  const results = await Promise.all(
    Object.entries(options.site.content).flatMap(([lang, language]) =>
      Object.values(language.pages).map(async (page) => {
        const source = ogImageOf(options, page)
        if (!design || !source) return null
        let ogResult: Awaited<ReturnType<typeof generateOgImage>>
        try {
          ogResult = await generateOgImage(
            page,
            source,
            placeFor(options.output, page)('og.jpg', 'og image'),
            joinPath(storeOf(options, page), 'og.jpg'),
            options.imageCache,
            design,
            lang,
          )
        } catch (error) {
          return { page, message: `the og image from ${source.rel} could not be made: ${why(error)}` }
        }
        page.hasOgImage = true
        page.isAiOg = ogResult.isAi
        page.ogCreditText = ogResult.creditText
        page.ogImageDesc = ogResult.imageDescription
        return ogResult.result
      }),
    ),
  )
  return count(results)
}

const count = (results: readonly (string | Problem | null)[]): Counted => ({
  built: results.filter((r) => r === 'generated').length,
  cached: results.filter((r) => r === 'cached').length,
  problems: results.filter((r): r is Problem => typeof r === 'object' && r !== null),
})
