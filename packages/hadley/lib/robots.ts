/** robots.txt: crawling allowed, the owner's optional content signal, and the sitemap of the default language. */
import type { Site } from './site.ts'

export function robotsTxt(site: Site): string {
  const signal: string | undefined = site.config.robots?.signal
  const origin = site.content[site.defaultLanguage]!.origin
  return [
    'User-agent: *',
    ...(signal === undefined ? [] : [`Content-Signal: ${signal}`]),
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}
