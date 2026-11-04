/** The notes of one language, prepared once for every page's noteList and html.notes (docs/themes.md, "Notes"). */
import util from '@mkorun/galley/util'
import type { SyncTemplate } from '@mkorun/galley'
import { categoryLabel } from './page-context.ts'
import type { Metadata, Site } from './site.ts'

export interface Notes {
  list: NoteEntry[]
  html: string
}

interface NoteEntry {
  id: string
  title: string
  publishFrom: Date
  link: string
  category: string
  categoryLabel: string | undefined
  tags: string[]
  ageDays: number
  meta: Metadata
  isDraft: boolean
}

export function notesFor(site: Site, lang: string, isPublish: boolean, template?: SyncTemplate): Notes {
  const locale = site.locales[lang] ?? {}
  const today = Date.parse(site.today)
  const notes = Object.values(site.content[lang]!.pages)
    .flatMap((page) => {
      // A missing date is already a problem of the note; a dev build cannot order or age it.
      if (page.type !== 'note' || !page.metadata.publishFrom || (isPublish && page.state !== 'published')) return []
      return [{ page, date: page.metadata.publishFrom }]
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime() || (a.page.id < b.page.id ? -1 : a.page.id > b.page.id ? 1 : 0))
  const list: NoteEntry[] = []
  const html: string[] = []
  for (const { page, date } of notes) {
    const entry: NoteEntry = {
      id: page.id,
      title: page.metadata.title,
      publishFrom: date,
      link: page.metadata.link ?? '',
      category: page.metadata.category ?? '',
      categoryLabel: categoryLabel(locale, page.metadata.category),
      tags: page.metadata.tags ?? [],
      // Calendar days, independent of time of day and daylight saving, on the build's scheduling day.
      ageDays: (today - Date.parse(date.toISOString().slice(0, 10))) / 86_400_000,
      meta: page.metadata,
      isDraft: page.state === 'draft' || page.state === 'seed',
    }
    list.push(entry)
    if (!template) continue
    if (page.markup === undefined) throw new Error(`${page.file}: the note's text has not been rendered`)
    try {
      html.push(
        template.render({ ...entry, html: { text: page.markup }, t: locale, meta: { ...entry.meta, lang } }, util),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${page.file}: rendered with templates/markup/note.sort: ${message}`, { cause: error })
    }
  }
  return { list, html: html.join('') }
}
