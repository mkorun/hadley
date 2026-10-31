// What a destination in the content names, and what an <m> around a resource asks of it. The renderer decides with
// these functions both when it records the files a page names and when it writes them; lib reads front matter files
// with readDestination as well.

import type { Document, ParseResult, RecoveryDocument } from '@markantolang/parser'

export type ResourceAttributes = {
  lang?: string
  preview?: string
  group?: string
  dataAttrs?: Record<string, string>
}

export function treeOf(result: ParseResult): Document | RecoveryDocument | undefined {
  if (result.status === 'ok') return result.document
  if (result.status === 'invalid') return result.recovery
  return undefined
}

/**
 * What a destination names, as a browser reads it from any page at the same path: resolved with `new URL` against
 * the page's path on two bases of other scheme and host (`https://a.invalid`, `http://b.invalid`). hadley decodes
 * nothing the parser has not.
 *
 * - Same absolute URL under both: external; its scheme must suit the use (http(s); links also mailto, tel; embeds
 *   https only). On the site's own origin it is a site path, checked like one and written as given.
 * - Same path on each base's own host: this site. Anything else (`//host`, `\\host`, `https:/x`) is refused.
 * - `$id` (links): that page in the page's language, resolved by the renderer.
 * - No path of its own (empty, `#…`, `?…`): this page; never a resource.
 * - Relative, in the page's directory, no trailing `/`: a bundle file, built or the page fails.
 * - Otherwise a site path: with `/` a page, else a file in the plan (lib/output.ts) outside a tool's directory.
 * - Refused too: an empty segment, one that does not decode or decodes to `/` or `\`.
 *
 * Written is what was checked: external and this-page references as given, all else resolved or under the built
 * file's name. Script is kept out by the site's Content Security Policy, not by this reading (AGENTS.md).
 */
export type Destination =
  | { kind: 'self'; href: string }
  | { kind: 'external'; href: string; scheme: string }
  | { kind: 'bundle'; rel: string; suffix: string } // rel: decoded, inside the page's directory
  | { kind: 'path'; path: string; suffix: string; href: string } // path: decoded, without its leading /; href: resolved
  | { kind: 'refused'; reason: string } // fails a published page

/** What a destination is for: a link, a file it shows (image, video, audio, preview, download), an embed, a data-*. */
export type Use = 'link' | 'resource' | 'embed' | 'data'

const SCHEMES: Record<Use, readonly string[]> = {
  link: ['http:', 'https:', 'mailto:', 'tel:'],
  resource: ['http:', 'https:'],
  embed: ['https:'],
  data: ['http:', 'https:', 'mailto:', 'tel:'],
}

const A = 'https://a.invalid'
const B = 'http://b.invalid'

const refused = (reason: string): Destination => ({ kind: 'refused', reason })

/**
 * `urlPath` is the page's URL path (`/`, `/a/`, `/en/a/`); `origin` the site's (`https://example.org`), without which
 * every absolute URL is external.
 */
export function readDestination(raw: string, use: Use, urlPath: string, origin?: string): Destination {
  const a = URL.parse(raw, A + urlPath)
  const b = URL.parse(raw, B + urlPath)
  if (a === null || b === null) return refused('is not a URL')
  const absolute = a.href === b.href
  // the site's origin as the URL standard writes it: https://SITE.example:443 is https://site.example
  const site = origin === undefined ? undefined : URL.parse(origin)?.origin
  if (absolute && a.origin !== site) {
    if (SCHEMES[use].includes(a.protocol)) return { kind: 'external', href: raw, scheme: a.protocol }
    const what = use === 'resource' ? 'file' : use === 'data' ? 'data-* value' : use
    return refused(`has a scheme a ${what} may not have (${a.protocol})`)
  }
  const here = absolute || (a.host === 'a.invalid' && b.host === 'b.invalid' && a.pathname === b.pathname)
  if (!here || a.search !== b.search || a.hash !== b.hash) return refused('means something else on another origin')
  if (use === 'embed') return refused('is not an https URL, which an embed needs')
  // no path of its own: it takes the file name of the page it is on, whatever that is
  const onR = URL.parse(raw, `${A}/q/r`)?.pathname
  const onS = URL.parse(raw, `${A}/q/s`)?.pathname
  if (!absolute && onR === '/q/r' && onS === '/q/s') {
    return use === 'resource' ? refused('names this page, not a file') : { kind: 'self', href: raw }
  }
  const segments = a.pathname.slice(1).split('/')
  if (segments.slice(0, -1).includes('')) return refused('has an empty segment')
  let decoded: string[]
  try {
    decoded = segments.map(decodeURIComponent)
  } catch {
    return refused('is not a valid URL path')
  }
  if (decoded.some((segment) => segment.includes('/') || segment.includes('\\'))) {
    return refused('holds an encoded / or \\ in a segment')
  }
  const path = decoded.join('/')
  const suffix = a.search + a.hash
  const dir = urlPath.slice(1)
  // a destination relative to the page's directory resolves elsewhere against another one
  const relative = !absolute && URL.parse(raw, `${A}/elsewhere/x/`)?.pathname !== a.pathname
  if (use !== 'data' && relative && path.startsWith(dir) && !path.endsWith('/')) {
    return { kind: 'bundle', rel: path.slice(dir.length), suffix }
  }
  if (use === 'resource' && (path === '' || path.endsWith('/'))) return refused('names a page, not a file')
  return { kind: 'path', path, suffix, href: absolute ? raw : a.pathname + suffix }
}

/** The image config an `<m>` around a block image selects. */
export function resourceConfigAttr(attrs?: ResourceAttributes): string | undefined {
  const data = attrs?.dataAttrs
  if (data?.style === 'doc') return 'doc'
  if (data?.size === 'native') return 'native'
  if (data?.size === '50%') return 'small'
  if (data?.size === '25%') return 'very-small'
  return undefined
}

/** An `<m data-size>` or `<m data-style>` keeps an inline image in the text flow, as a plain, copied `<img>`. */
export function sizesInline(attrs?: ResourceAttributes): boolean {
  return attrs?.dataAttrs?.size !== undefined || attrs?.dataAttrs?.style !== undefined
}
