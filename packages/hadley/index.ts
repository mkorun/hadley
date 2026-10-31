/**
 * A build: the order of its steps and their log. Each step is a module of lib/ with its data in and out; the plan
 * (lib/output.ts) claims every path before anything is built, so nothing is written twice or left out.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join as joinPath } from 'node:path'
import {
  initHighlighter,
  prepareHighlighter,
  getHighlighterCSS,
  loadHighlightingCache,
  getHighlightingCache,
  isHighlightingCacheModified,
  type HighlightCacheFile,
} from './case/index.ts'
import { logger, isVerbose, formatMs } from './lib/logger.ts'
import loadSite from './lib/load-site.ts'
import compileTemplates, { compileHeading } from './lib/compile-templates.ts'
import type { ImageCache, ImageConfigs } from './lib/images.ts'
import { feedLanguages, feedUrl, feedXml } from './lib/feed.ts'
import { generateOgDefault } from './lib/generate-og-default.ts'
import { llmsTxt } from './lib/llms.ts'
import { markdownPath } from './lib/markdown.ts'
import { loadOgDesign } from './lib/og.ts'
import { Output } from './lib/output.ts'
import { settle } from './lib/problems.ts'
import { buildCovers, buildFiles, buildOgImages, checkSitePaths, pageOwner, planOgImages } from './lib/page-files.ts'
import { errorCopies } from './lib/error-pages.ts'
import { renderContent, type BlockEditorHook } from './lib/render-content.ts'
import { linksJson, metaJson, siteJson, sitelinksJson } from './lib/site-data.ts'
import { runPagefind } from './lib/search.ts'
import { highlightingThemes, underMaintenance } from './lib/site-config.ts'
import { siteRoot } from './lib/site-root.ts'
import { sitemapXml } from './lib/sitemap.ts'
import { assetsFor, planTheme, published, writeTheme } from './lib/theme-files.ts'
import { writePages } from './lib/write-pages.ts'

// siteDir: the site's directory (lib/site-root.ts)
export async function build(
  siteDir: string,
  outputMode: 'dev' | 'publish',
  // deferSearch: the search index is not written, but returned as `search`, for the caller to write when it suits it
  // (the dev server, after the page reloaded); nothing else writes into the output until it is done
  opts?: { localServer?: boolean; blockEditorHook?: BlockEditorHook; deferSearch?: boolean },
): Promise<{ searchable: string[]; planned: string[]; search?: () => Promise<void> }> {
  const isPublish = outputMode === 'publish'
  const outputDir = `.hadley/${outputMode}`
  const outDir = joinPath(siteDir, outputDir)

  logger.header(outputMode)

  if (isPublish) {
    await rm(outDir, { recursive: true, force: true })
  }
  await mkdir(outDir, { recursive: true })
  const output = new Output(outDir)
  const write = async (rel: string, owner: string, text: string) => {
    const file = output.claim(rel, owner)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }

  const doneTemplates = logger.step('compile templates')
  const templatesDir = joinPath(siteDir, 'theme', 'templates')
  const galleyOptions = {
    includes: { import: (path: string, enc: string) => readFile(path, enc as BufferEncoding), basedir: templatesDir },
  }
  const templates = await compileTemplates(galleyOptions)
  const headingTemplate = await compileHeading(galleyOptions)
  doneTemplates()

  const doneSite = logger.step('load site')
  const localServer = outputMode === 'dev' || opts?.localServer === true
  const site = await loadSite(siteDir, isPublish, localServer)
  // under maintenance a publish build makes the 503 page alone: no feed, sitemap, llms.txt or search (config.md)
  const maintenance = isPublish && underMaintenance(site.config)
  const feeds = maintenance ? [] : feedLanguages(site)
  // undefined unless config.lima enables og images; then their design is complete, or the build stops here
  const og = await loadOgDesign(siteDir, site.config, site.content, site.defaultLanguage)
  // what the theme publishes, by output path, under its final name: writeTheme() writes it, templates read the names
  // as assets, and a site path in content names one
  const themeDir = joinPath(siteDir, 'theme')
  const themeFiles = await planTheme(themeDir, isPublish)
  // a publish build has only the pages it writes (lib/load-site.ts)
  const allPages = Object.values(site.content).flatMap((language) => Object.values(language.pages))
  // a page names a template of the theme, or the build stops before any work
  const untemplated = allPages.filter((page) => page.outputs.html && !Object.hasOwn(templates, page.template))
  if (untemplated.length > 0) {
    const lines = untemplated.map(
      (p) => `${p.file}: the theme has no template ${p.template} (templates/${p.template}.chase)`,
    )
    throw new Error(`cannot build:\n${lines.join('\n')}`)
  }

  // The plan (lib/output.ts): every page, theme and site file is claimed before anything is built, so two owners of
  // one path stop the build before any work; a page's own files, the syntax stylesheet, the covers and the og images
  // are claimed as they are built or planned, before any site path is checked and any page renders.
  for (const page of allPages)
    if (page.outputs.html) output.claim(page.urlPath.slice(1) + 'index.html', pageOwner(page))
  for (const page of allPages)
    if (page.outputs.markdown) output.claim(markdownPath(page), `${pageOwner(page)}: Markdown twin`)
  for (const file of themeFiles.values()) output.claim(file.name, `theme: ${file.source}`)
  const siteFiles: [string, string][] = maintenance
    ? []
    : [
        ['sitemap.xml', 'site: sitemap'],
        ['llms.txt', 'site: llms.txt'],
      ]
  for (const lang of feeds) siteFiles.push([feedUrl(site, lang).slice(1), `site: feed ${lang}`])
  if (og) siteFiles.push(['og-default.jpg', 'site: og-default'])
  if (!isPublish) siteFiles.push(['sitelinks.json', 'site: sitelinks.json'])
  if (maintenance) {
    if (!site.content[site.defaultLanguage]?.pages['503'])
      throw new Error(`config.lima: maintenance is on, but @errors/[503] has no page in ${site.defaultLanguage}`)
    siteFiles.push(['.maintenance', 'site: the mark of maintenance'])
  }
  for (const [rel, owner] of siteFiles) output.claim(rel, owner)
  // the error pages again: 404.html for a host with no rules, under maintenance each home too (lib/error-pages.ts)
  const copies = isPublish ? errorCopies(site, maintenance) : []
  for (const { rel, page } of copies) output.claim(rel, `${pageOwner(page)}: its copy`)
  // the search index, written last from the pages written (lib/search.ts)
  const search = site.config.search?.enabled === true && !maintenance
  if (search) output.claimDirectory('pagefind', 'site: search index')

  // code is first highlighted when the pages' files are recorded, below
  await initHighlighter(highlightingThemes(site.config), joinPath(siteDir, 'theme', 'highlighting'))
  const hlCachePath = joinPath(siteDir, '.hadley', 'cache', 'highlighting.json')
  let hlCache: HighlightCacheFile | undefined
  try {
    hlCache = JSON.parse(await readFile(hlCachePath, 'utf-8'))
  } catch {}
  loadHighlightingCache(hlCache)
  await prepareHighlighter(allPages.map((page) => page.doc))

  const unpublishedCount = allPages.filter((p) => !p.published).length
  doneSite(
    site.skipped > 0
      ? `${allPages.length} pages · ${site.skipped} unpublished skipped`
      : `${allPages.length} pages${unpublishedCount > 0 ? ` · ${unpublishedCount} unpublished` : ''}`,
    settle(site.problems, isPublish),
  )
  for (const behind of site.behind) logger.warn(behind)
  if (!isPublish && underMaintenance(site.config))
    logger.warn('maintenance is on: a publish build makes only the page @errors/[503] (hadley deploy shows it)')

  const cacheDir = joinPath(siteDir, '.hadley', 'cache')
  const cachePath = joinPath(cacheDir, 'images.json')
  await mkdir(cacheDir, { recursive: true })
  let imageCache: ImageCache = {}
  try {
    imageCache = JSON.parse(await readFile(cachePath, 'utf-8'))
  } catch {}
  const filesOptions = {
    site,
    siteDir,
    imageConfigs: (template: string) => (templates[template]?.images ?? {}) as ImageConfigs,
    output,
    imageCache,
    og,
    isPublish,
  }

  const doneImages = logger.step('generate images')
  const files = await buildFiles(filesOptions)
  doneImages(`${files.images.built} new · ${files.images.cached} cached`, settle(files.problems, isPublish))

  // the names templates read as assets, and site paths resolve to: the theme's files and the stylesheet of the
  // highlighted code, which is complete once every page's code was highlighted, when its files were recorded above
  const assetNames = new Map([...themeFiles].map(([path, file]) => [path, file.name]))
  const syntaxPath = 'assets/css/syntax-highlighting.css'
  const syntaxCss = getHighlighterCSS()
  // written whenever config.lima names code colours, so that a template links it whether a page has code or not
  if (syntaxCss || highlightingThemes(site.config) !== undefined) {
    const theme = themeFiles.get(syntaxPath)
    if (theme) throw new Error(`${syntaxPath} is written by both theme: ${theme.source} and site: syntax highlighting`)
    const css = isPublish ? await published(syntaxPath, syntaxCss) : { name: syntaxPath, bytes: syntaxCss }
    await write(css.name, 'site: syntax highlighting', css.bytes)
    assetNames.set(syntaxPath, css.name)
  }

  const doneCover = logger.step('generate cover images')
  const covers = await buildCovers(filesOptions)
  doneCover(`${covers.built} new · ${covers.cached} cached`, settle(covers.problems, isPublish))
  planOgImages(filesOptions)

  const donePaths = logger.step('check site paths')
  const pathProblems = checkSitePaths(filesOptions, files.requests, assetNames)
  donePaths(`${files.requests.size} pages`, settle(pathProblems, isPublish))

  const doneContent = logger.step('render content')
  const contentProblems = renderContent(site, isPublish, opts?.blockEditorHook, headingTemplate)
  doneContent(`${allPages.length} pages`, settle(contentProblems, isPublish))

  if (isPublish) {
    await mkdir(joinPath(siteDir, '.hadley'), { recursive: true })
    await writeFile(joinPath(siteDir, '.hadley', 'meta.json'), metaJson(site))
    await writeFile(joinPath(siteDir, '.hadley', 'links.json'), linksJson(site))
  } else {
    // not in the output, which hadley dev serves, with --host to other devices: it holds the configuration
    await writeFile(joinPath(siteDir, '.hadley', 'site.json'), siteJson(site))
    await rm(joinPath(outDir, 'site.json'), { force: true })
    await write('sitelinks.json', 'site: sitelinks.json', sitelinksJson(site))
  }

  if (isHighlightingCacheModified()) await writeFile(hlCachePath, JSON.stringify(getHighlightingCache()))

  const doneOg = logger.step('generate og images')
  const ogImages = await buildOgImages(filesOptions)
  await writeFile(cachePath, JSON.stringify(imageCache))
  doneOg(og ? `${ogImages.built} new · ${ogImages.cached} cached` : 'off', settle(ogImages.problems, isPublish))

  const doneRender = logger.step('render pages')
  const pages = await writePages(templates, output, {
    site,
    feeds,
    assets: assetsFor(assetNames),
    isPublish,
    og: og !== undefined,
  })
  doneRender(`${pages.count} pages → ${outputDir}/`, settle(pages.problems, isPublish))
  if (isVerbose) {
    logger.verbose(
      pages.timings.map(({ page, ms }) => {
        const urlPath = ('/' + page.language + page.urlPath).replace(/\/$/, '') || '/'
        return `→ ${urlPath.padEnd(32)} ${formatMs(ms).padStart(6)}`
      }),
    )
  }

  if (copies.length > 0) {
    const doneCopies = logger.step('copy error pages')
    for (const { rel, page } of copies)
      await write(
        rel,
        `${pageOwner(page)}: its copy`,
        await readFile(joinPath(outDir, page.urlPath, 'index.html'), 'utf-8'),
      )
    doneCopies(copies.map(({ rel }) => `/${rel}`).join(' · '))
  }

  if (maintenance) {
    // the mark a server answers every page by with the 503 page (deploy.md, "Maintenance")
    await write('.maintenance', 'site: the mark of maintenance', '')
  } else {
    const doneSitemap = logger.step('generate sitemap')
    const sitemap = sitemapXml(site)
    await write('sitemap.xml', 'site: sitemap', sitemap.text)
    doneSitemap(`${sitemap.count} URLs`)
  }

  if (feeds.length > 0) {
    const doneRss = logger.step('generate feeds')
    const counts = []
    for (const lang of feeds) {
      const feed = feedXml(site, lang)
      await write(feedUrl(site, lang).slice(1), `site: feed ${lang}`, feed.text)
      counts.push(`${lang} ${feed.count}`)
    }
    doneRss(`${counts.join(' · ')} articles`)
  }

  const doneCopy = logger.step('copy assets')
  // a dev build leaves a copy newer than its source
  const copiedCount = await writeTheme(themeDir, themeFiles, output, !isPublish)
  doneCopy(copiedCount > 0 ? `${copiedCount} file${copiedCount > 1 ? 's' : ''} copied` : 'all up to date')

  // from the claim and logo when og images are on; a failure stops the build
  if (og) {
    const doneOgDefault = logger.step('generate og-default')
    await generateOgDefault(og, output.claim('og-default.jpg', 'site: og-default'), joinPath(cacheDir, 'images'))
    doneOgDefault()
  }

  if (!maintenance) {
    const doneLlms = logger.step('generate llms.txt')
    await write('llms.txt', 'site: llms.txt', llmsTxt(site))
    doneLlms()
  }

  const writeSearch = async () => {
    const doneSearch = logger.step('build search index')
    await runPagefind(outDir, pages.searchable, joinPath(cacheDir, 'search', outputMode))
    doneSearch(`${pages.searchable.length} pages`)
  }
  if (search && !opts?.deferSearch) await writeSearch()

  logger.footer()
  return {
    searchable: pages.searchable,
    planned: output.list(),
    ...(search && opts?.deferSearch ? { search: writeSearch } : {}),
  }
}

// ── Script entry point (bun index.ts / bun run build) ────────────────────────
if (import.meta.main) {
  const outputMode = (process.env.HADLEY_OUTPUT ?? 'dev') as 'dev' | 'publish'
  let siteDir
  try {
    siteDir = siteRoot(undefined)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
  await build(siteDir, outputMode)
}
