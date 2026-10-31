/** Every page with a page of its own, rendered with its template, formatted with quad and written where claimed. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join as joinPath } from 'node:path'
import quad from '@mkorun/quad'
import util from '@mkorun/galley/util'
import type compileTemplates from './compile-templates.ts'
import type { Output } from './output.ts'
import type { Problem } from './problems.ts'
import { feedPages, feedUrl } from './feed.ts'
import { pageOwner } from './page-files.ts'
import { pageContext, type ContextOptions } from './page-context.ts'
import { siteView } from './site-view.ts'
import { markdownPath, markdownTwin } from './markdown.ts'
import type { Page } from './site.ts'

export type Templates = Awaited<ReturnType<typeof compileTemplates>>

export interface Written {
  count: number
  problems: Problem[] // HTML of a page quad cannot format, written as rendered
  searchable: string[] // the pages the search index holds, as paths in the output directory
  timings: { page: Page; ms: number }[]
}

// a failing template names the page it was rendering
const renderWith = (page: Page, render: () => string): string => {
  try {
    return render()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${page.file}: rendered with templates/${page.template}.chase: ${message}`, { cause: error })
  }
}

export async function writePages(
  templates: Templates,
  output: Output,
  { feeds, ...options }: Omit<ContextOptions, 'view' | 'comments' | 'feed'> & { feeds: string[] },
): Promise<Written> {
  const { site, isPublish } = options
  const written: Written = { count: 0, problems: [], searchable: [], timings: [] }
  // quad formats every page; HTML it cannot format is written as rendered, and a problem of the page
  const formatHtml = (page: Page, html: string): string => {
    try {
      return quad(html, { stripComments: isPublish })
    } catch (error) {
      written.problems.push({ page, message: `quad cannot format the HTML of its template ${page.template}: ${error}` })
      return html
    }
  }
  // a page's Markdown twin; what keeps it from being written is a problem of the page, as for the page's HTML
  const twinOf = (page: Page): string | undefined => {
    try {
      return markdownTwin(site, page)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      written.problems.push({ page, message: `its Markdown twin: ${message}` })
      return undefined
    }
  }
  for (const [lang, language] of Object.entries(site.content)) {
    // what a template sees of its language (lib/site-view.ts)
    const view = siteView(language, lang)
    const feed = feeds.includes(lang) ? { url: feedUrl(site, lang), pages: feedPages(site, lang) } : undefined
    for (const page of Object.values(language.pages)) {
      if (!page.outputs.html) continue
      const template = templates[page.template]
      if (!template || typeof template.render !== 'function') throw new Error('Missing template: ' + page.template)
      const t0 = performance.now()
      // the comments of an article, which the comments tool writes into its bundle, those of another language than the
      // default into that language's folder of it (addons/forms, services/forms/CONTRACT.md C10)
      const commentsDir = lang === site.defaultLanguage ? page.bundleDir : joinPath(page.bundleDir, lang)
      const comments = page.articleLike
        ? await readFile(joinPath(commentsDir, '_comments.html'), 'utf-8').catch(() => undefined)
        : undefined
      const context = pageContext(page, { ...options, view, comments, feed })
      const html = formatHtml(
        page,
        renderWith(page, () => template.render(context, util)),
      )
      const htmlFile = output.claim(page.urlPath.slice(1) + 'index.html', pageOwner(page))
      await mkdir(dirname(htmlFile), { recursive: true })
      await writeFile(htmlFile, html)
      if (page.outputs.markdown) {
        const markdownFile = output.claim(markdownPath(page), `${pageOwner(page)}: Markdown twin`)
        const twin = twinOf(page)
        // one of an earlier dev build must not stand in for it
        if (twin === undefined) await rm(markdownFile, { force: true })
        else await writeFile(markdownFile, twin)
      }
      if (page.outputs.search) written.searchable.push(page.urlPath.slice(1) + 'index.html')
      written.count++
      written.timings.push({ page, ms: performance.now() - t0 })
    }
  }
  return written
}
