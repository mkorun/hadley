/**
 * llms.txt of the default language.
 * Description: site.description (config.lima) — home page metadata.description overrides if set
 * Contact:     content/meta/persons/<id>.lima, referenced via site.owner (%persons/<id>)
 * Labels:      theme/i18n/<lang>.lima → llms.*
 */
import { feedLanguages, feedUrl } from './feed.ts'
import { PROFILES } from './persons.ts'
import type { Page, Site } from './site.ts'

// llms.txt is Markdown: a value is text in it, never a link, emphasis, a heading or a line of its own; a link's
// destination cannot end early at a parenthesis.
const md = (value: unknown): string =>
  String(value)
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\\`*_[\]<>#]/g, (c) => `\\${c}`)
const mdLink = (text: unknown, url: string): string =>
  `[${md(text)}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
// a page with a Markdown twin is linked by its twin (lib/markdown.ts)
const pageUrl = (page: Page, origin: string): string =>
  `${origin}${page.urlPath}${page.outputs.markdown ? 'index.html.md' : ''}`

const LABELS = {
  author: 'Author',
  contact: 'Contact',
  articles: 'Articles',
  morePages: 'More pages',
  allPages: 'All pages',
}

export function llmsTxt(site: Site): string {
  const language = site.content[site.defaultLanguage]!
  // the owner's person file, which config.lima names
  const owner = (language.ownerLinks ?? {}) as Record<string, string | undefined>
  const labels = { ...LABELS, ...(site.locales[site.defaultLanguage]?.llms as Record<string, string>) }
  const homePage = Object.values(language.pages).find((p) => p.template === 'home')
  const origin = language.origin
  const issn: string = site.config.site?.issn ?? ''
  const repository: string = site.config.site?.repository ?? ''
  const description = homePage?.metadata.description ?? language.description ?? ''

  // "More pages" order: follow a nav (footer, then main) where one exists, then
  // any remaining pages by urlPath. A nav entry is matched to a page by urlPath.
  const nav = language.navigations.footer ?? language.navigations.main ?? []
  const navOrder = (urlPath: string): number => {
    const i = nav.findIndex((n) => n.urlPath === urlPath)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }

  // an undated article sorts as NaN, as new Date(undefined) did
  const latestTime = (p: Page) => (p.metadata.updatedAt ?? p.metadata.publishFrom)?.getTime() ?? NaN
  const articles = Object.values(language.pages)
    .filter((p) => p.articleLike && p.outputs.llms)
    .sort((a, b) => latestTime(b) - latestTime(a))

  // Every non-article, non-home page in the sitemap — regardless of which
  // template renders it (a site may use `spec`, `page`, or any custom layout).
  const otherPages = Object.values(language.pages)
    .filter((p) => !p.articleLike && p.outputs.llms)
    .sort((a, b) => navOrder(a.urlPath) - navOrder(b.urlPath) || a.urlPath.localeCompare(b.urlPath))

  const lines: string[] = [
    `# ${md(language.title ?? '')}`,
    ...(description ? ['', `> ${md(description)}`] : []),
    '',
    ...(owner.name ? [`${md(labels.author)}: ${md(owner.name)}`] : []),
    ...(owner.email ? [`${md(labels.contact)}: ${md(owner.email)}`] : []),
    ...(owner.mastodon ? [`${PROFILES.mastodon}: ${md(owner.mastodon)}`] : []),
    ...(owner.github ? [`${PROFILES.github}: ${md(owner.github)}`] : []),
    ...(repository ? [`Repository: ${md(repository)}`] : []),
    ...(issn ? [`ISSN: ${md(issn)}`] : []),
  ]

  if (articles.length) {
    lines.push('', `## ${md(labels.articles)}`, '')
    for (const p of articles) {
      const desc = p.metadata.description ? `: ${md(p.metadata.description)}` : ''
      lines.push(`- ${mdLink(p.metadata.title, pageUrl(p, origin))}${desc}`)
    }
  }

  lines.push('', `## ${md(labels.morePages)}`, '')
  for (const p of otherPages) {
    const label = p.metadata.linktext ?? p.metadata.title
    const desc = p.metadata.description ? `: ${md(p.metadata.description)}` : ''
    lines.push(`- ${mdLink(label, pageUrl(p, origin))}${desc}`)
  }
  lines.push(
    ...(feedLanguages(site).includes(site.defaultLanguage)
      ? [`- ${mdLink('Feed', `${origin}${feedUrl(site, site.defaultLanguage)}`)}: RSS/Atom`]
      : []),
    `- ${mdLink('Sitemap', `${origin}/sitemap.xml`)}: ${md(labels.allPages)}`,
  )
  return lines.join('\n') + '\n'
}
