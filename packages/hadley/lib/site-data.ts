/**
 * What hadley writes about the site for its tools rather than for readers: meta.json (the site's origin and language
 * and its articles, for the VG Wort report and the comments service's notifications, docs/comments.md) and
 * links.json (the external links) next to a publish build; site.json (the site as loaded, for a look at it) next to a
 * dev build, and sitelinks.json (the pages a $id link can reach, for the editors) in it.
 */
import type { Site } from './site.ts'

export function metaJson(site: Site): string {
  const articles: { published: Date | null; [field: string]: unknown }[] = []
  for (const [lang, { pages }] of Object.entries(site.content)) {
    for (const [id, page] of Object.entries(pages)) {
      if (!page.articleLike) continue
      articles.push({
        id,
        path: page.urlPath,
        lang,
        title: page.metadata.title,
        tags: page.metadata.tags ?? [],
        published: page.metadata.publishFrom ?? null,
        status: page.state,
        charCount: page.result?.charCount ?? 0,
        ...(page.metadata.vgwort_pixel !== undefined ? { vgwort_pixel: page.metadata.vgwort_pixel } : {}),
      })
    }
  }
  const time = (date: Date | null) => date?.getTime() ?? 0
  articles.sort((a, b) => (time(b.published) > time(a.published) ? 1 : -1))
  return JSON.stringify(
    { origin: site.content[site.defaultLanguage]!.origin, language: site.defaultLanguage, articles },
    null,
    2,
  )
}

export function linksJson(site: Site): string {
  const links = new Map<string, { url: string; pages: { id: string; lang: string }[] }>()
  for (const [lang, { pages }] of Object.entries(site.content)) {
    for (const [id, page] of Object.entries(pages)) {
      for (const url of page.result?.externalLinks ?? []) {
        if (!links.has(url)) links.set(url, { url, pages: [] })
        links.get(url)!.pages.push({ id, lang })
      }
    }
  }
  return JSON.stringify([...links.values()], null, 2)
}

/** The site as loaded: without the parsed documents, the built files and the listed pages, which repeat pages. */
export function siteJson(site: Site): string {
  return JSON.stringify(
    site,
    (key, value) =>
      key === 'doc' || key === 'files' || key === 'listed' ? undefined : value instanceof Set ? [...value] : value,
    2,
  )
}

export function sitelinksJson(site: Site): string {
  const pages = []
  for (const [lang, language] of Object.entries(site.content)) {
    for (const [id, page] of Object.entries(language.pages)) {
      // the pages a $id link can reach: a note has no page of its own yet
      if (!page.outputs.html) continue
      pages.push({ id, lang, title: page.metadata.title, status: page.state, urlPath: page.urlPath, type: page.type })
    }
  }
  return JSON.stringify({ defaultLang: site.defaultLanguage, pages }, null, 2)
}
