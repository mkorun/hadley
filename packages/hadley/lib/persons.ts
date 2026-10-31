/**
 * A person (content/meta/persons/, docs/themes.md "Persons") as the pages of one language read it: a page's `author`
 * and the site's `owner`. Its fields are those of the default language; a block named after a language of the site
 * replaces fields for that language's pages, and a `url` written `$id` is the URL path of that page in the language.
 */
import type { Site } from './site.ts'

/** A person's profiles (docs/themes.md "Persons"): by field, in the order the JSON-LD names them, with their label. */
export const PROFILES: Readonly<Record<string, string>> = {
  github: 'GitHub',
  mastodon: 'Mastodon',
  linkedin: 'LinkedIn',
  xing: 'XING',
  npm: 'npm',
  dev_to: 'DEV',
  bluesky: 'Bluesky',
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

/** `person` for the pages of `lang`; `where` names it in a message. A new object: a person is shared by its pages. */
export function personFor(
  person: Record<string, unknown>,
  lang: string,
  site: Site,
  where: string,
): Record<string, unknown> {
  const languages = Object.keys(site.content)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(person)) {
    if (!languages.includes(key)) result[key] = value
    else if (!isMapping(value))
      throw new Error(`${where}: ${key} is a language of the site, so it holds a block of fields`)
  }
  const block = person[lang]
  if (isMapping(block)) Object.assign(result, block)
  const url = result.url
  if (typeof url === 'string' && url.startsWith('$')) {
    const path = site.translationMappings[url.slice(1)]?.[lang]
    if (path === undefined)
      throw new Error(`${where}: url ${url}: the language "${lang}" lists no page ${url.slice(1)}`)
    result.url = path
  }
  return result
}

/** The owner's profiles config.lima names in `profiles`, in its order, as `links` holds them. */
function profilesOf(named: unknown, links: Record<string, unknown>): { network: string; label: string; url: string }[] {
  if (named === undefined) return []
  if (!Array.isArray(named)) throw new Error('config.lima: profiles is a list of profiles, such as [github, mastodon]')
  return named.map((network) => {
    if (typeof network !== 'string' || !Object.hasOwn(PROFILES, network))
      throw new Error(`config.lima: profiles: ${network} is not one of ${Object.keys(PROFILES).join(', ')}`)
    const url = links[network]
    if (typeof url !== 'string' || url === '')
      throw new Error(`config.lima: profiles: ${network}: the owner (site.owner) has no ${network}`)
    return { network, label: PROFILES[network]!, url }
  })
}

/**
 * Every page's `author` and every language's owner as that language reads them, once the pages are listed. The owner
 * gets the links a template writes: `emailMailto`, `mobileHref` from its mobile number, and the `profiles` config.lima
 * names.
 */
export function resolvePersons(site: Site): void {
  const owner = site.config.site?.owner
  const named = site.config.profiles
  if (named !== undefined && !isMapping(owner))
    throw new Error('config.lima: profiles names profiles of the owner, and site.owner names none')
  for (const [lang, language] of Object.entries(site.content)) {
    for (const page of Object.values(language.pages)) {
      const author = page.metadata.author
      if (isMapping(author)) page.metadata.author = personFor(author, lang, site, `${page.file}: author`)
    }
    if (!isMapping(owner)) continue
    const links = personFor(owner, lang, site, 'config.lima: site.owner')
    if (links.email) links.emailMailto = `mailto:${links.email}`
    if (links.mobile)
      links.mobileHref =
        'tel:' +
        String(links.mobile)
          .replace(/\s*\(0\)\s*/g, '')
          .replace(/\s/g, '')
    links.profiles = profilesOf(named, links)
    language.ownerLinks = links
  }
}
