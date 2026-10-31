/** sitemap.xml: every page whose outputs name it (lib/site.ts), with the date it last changed. */
import type { Site } from './site.ts'
import { element, xmlDocument, type XmlElement } from './xml.ts'

/** A date as the sitemap and the feed write it: YYYY-MM-DD in UTC. */
export const isoDay = (date: Date | undefined): string | null => date?.toISOString().slice(0, 10) ?? null

/** The sitemap, and how many URLs it holds. A home page changed when the latest listed article did. */
export function sitemapXml(site: Site): { text: string; count: number } {
  const urls: XmlElement[] = []
  for (const { origin, pages, listed } of Object.values(site.content)) {
    for (const page of Object.values(pages)) {
      if (!page.outputs.sitemap) continue
      let date = page.metadata.updatedAt ?? page.metadata.publishFrom
      if (page.template === 'home') {
        date =
          Object.values(listed)
            .flatMap((p) => {
              const latest = p.metadata.updatedAt ?? p.metadata.publishFrom
              return p.articleLike && p.metadata.publishFrom && latest ? [latest] : []
            })
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? date
      }
      const day = isoDay(date)
      const lastmod = day ? [element('lastmod', [], day)] : []
      urls.push(element('url', [], element('loc', [], `${origin}${page.urlPath}`), ...lastmod))
    }
  }
  const sitemap = element('urlset', [['xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9']], ...urls)
  return { text: xmlDocument(sitemap), count: urls.length }
}
