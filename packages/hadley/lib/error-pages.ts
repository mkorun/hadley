// The error pages under the names a host shows them by. A host with no rules of its own (GitHub Pages, Netlify,
// Cloudflare Pages) answers a missing page with the 404.html nearest to it, so the build copies each language's page
// @errors/[404] there: the default language's to the root, another's into its folder. Under maintenance the 503 page
// takes their place, and the place of each language's home as well, as the build has no other page (deploy.md).

import type { Page, Site } from './site.ts'

export interface ErrorCopy {
  rel: string // the copy's path in the output directory
  page: Page // the error page it copies
}

export function errorCopies(site: Site, maintenance: boolean): ErrorCopy[] {
  const copies: ErrorCopy[] = []
  for (const [language, { pages }] of Object.entries(site.content)) {
    const page = pages[maintenance ? '503' : '404']
    if (!page?.collections.includes('errors') || !page.outputs.html) continue
    const folder = language === site.defaultLanguage ? '' : `${language}/`
    copies.push({ rel: `${folder}404.html`, page })
    if (maintenance) copies.push({ rel: `${folder}index.html`, page })
  }
  return copies
}
