/**
 * The content of each page, rendered once its files are built: its markup and what comes from it, the table of
 * contents, the character count and a description written from the text.
 */
import util from '@mkorun/galley/util'
import type { SyncTemplate } from '@mkorun/galley'
import { render, type BlockToken, type Heading } from '../case/index.ts'
import type { Problem } from './problems.ts'
import type { Page, Site } from './site.ts'

/** The block editor's hook (addons/editor): the id of the block at a source offset, given the page's blocks. */
export type BlockEditorHook = (
  blocks: BlockToken[],
  filePath: string,
  rawDoc: string,
) => (start: number) => string | undefined

/**
 * The characters of a page for the VG Wort, by grapheme: its title, subtitle and the text a reader reads (`bodyText`
 * of render(), without captions, footnotes and :::nocount).
 */
export const charCount = (parts: readonly unknown[], language: string): number => {
  let count = 0
  for (const _ of segmenter(language).segment(parts.filter(Boolean).join(' '))) count++
  return count
}

const segmenters = new Map<string, Intl.Segmenter>()
const segmenter = (language: string) => {
  let made = segmenters.get(language)
  if (!made) segmenters.set(language, (made = new Intl.Segmenter(language)))
  return made
}

/** How a page is rendered; fileRequests() records with the same options render() writes with. */
export const renderOptions = (site: Site, page: Page, isPublish: boolean) => ({
  bundlePath: page.bundleDir,
  urlPath: page.urlPath,
  origin: site.content[page.language]!.origin,
  lang: page.language,
  typography: site.config.typography?.enabled === true,
  translationMappings: site.translationMappings,
  unpublishedIds: site.unpublishedIds[page.language]!,
  unlinkUnpublished: isPublish,
})

/**
 * Renders every page's content once its files are built (`page.files`, see lib/build-files.ts), and derives what
 * comes from the rendered page: markup, table of contents, character count and description. Returns what the
 * renderer left out: a URL it blocked, an attribute hadley writes itself.
 */
export const renderContent = (
  site: Site,
  isPublish: boolean,
  blockEditorHook?: BlockEditorHook,
  headingTemplate?: SyncTemplate,
): Problem[] => {
  const problems: Problem[] = []
  for (const { pages } of Object.values(site.content)) {
    for (const page of Object.values(pages)) {
      // a page of another repository is edited there, not here (docs/sources.md)
      const getBlockId = page.fromSource ? undefined : blockEditorHook?.(page.doc.blocks, page.file, page.source)
      const t = site.locales[page.language] ?? {}
      const heading = headingTemplate
        ? ({ level, id, html }: Heading) =>
            headingTemplate.render({ level, id, html: { text: html }, t, meta: { lang: page.language } }, util)
        : undefined
      const r = render(page.doc, {
        ...renderOptions(site, page, isPublish),
        ...(page.files ? { files: page.files } : {}),
        ...(getBlockId ? { getBlockId } : {}),
        ...(heading ? { heading } : {}),
      })
      page.markup = r.html
      const bodyText = r.bodyText.normalize('NFC')

      page.result = {
        toc: r.toc,
        shortcodes: r.annotations.map((a, i) => ({
          id: i + 1,
          type: a.type,
          href: a.href,
          ...(a.text ? { text: a.text } : {}),
        })),
        charCount: charCount([page.metadata.title, page.metadata.subtitle, bodyText], page.language),
        externalLinks: r.externalLinks,
        ...(r.tldr !== undefined ? { tldr: r.tldr } : {}),
      }

      // left out: what the content asked for is not on the page
      for (const name of r.ignoredAttributes) {
        problems.push({ page, message: `the attribute ${name} is one hadley writes itself; it is left out` })
      }

      // Auto-description from the page's text
      if (!page.metadata.description && bodyText) {
        page.metadata.description =
          bodyText.length > 160 ? bodyText.slice(0, 157).replace(/\s+\S*$/, '') + '…' : bodyText
      }
    }
  }
  return problems
}
