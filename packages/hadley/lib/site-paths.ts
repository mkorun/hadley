/**
 * The one place where a name from content becomes a path (AGENTS.md, "Security"). A file content names is looked up
 * in the page's directory and, for a page in a language directory of a bundle, then in the bundle; what is built from
 * it goes into the page's output directory. A name that would leave either is refused, and so is a URL path that
 * would put a page's output directory outside the site's.
 */
import { dirname, isAbsolute, join, relative } from 'node:path'
import { existsExactly, isSystemFile } from './platform.ts'

/** A file content names: its path relative to the page's directory, and where it was found. */
export type ContentFile = { rel: string; source: string }

export type Refused = { refused: string }

/**
 * A file of the bundle as readDestination (case/) read it from content: decoded, relative to the page's
 * directory. Refused all the same, as the last check before it becomes a path: an absolute one, a backslash, an
 * empty, `.` or `..` segment, and a file the operating system leaves (docs/platforms.md).
 */
export function contentPath(rel: string): { rel: string } | Refused {
  if (rel.startsWith('/') || rel.includes('\\')) return { refused: 'is not a path inside the bundle' }
  if (rel.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { refused: 'is not a plain path inside the bundle' }
  }
  if (rel.split('/').some(isSystemFile))
    return { refused: 'is a file the operating system leaves, not one of the bundle' }
  return { rel }
}

/** The directories a page's files are looked up in: its own, then the bundle when it sits in a language directory. */
export function lookupDirs(pageFile: string): string[] {
  const dir = dirname(pageFile)
  const parent = dirname(dir)
  return /\[[^\]]+\]$/.test(parent) ? [dir, parent] : [dir]
}

/** Finds the file of the bundle a page's content names (`rel`, decoded), or says why there is none. */
export async function findContentFile(pageFile: string, rel: string): Promise<ContentFile | Refused> {
  const path = contentPath(rel)
  if ('refused' in path) return path
  for (const dir of lookupDirs(pageFile)) {
    const source = join(dir, path.rel)
    // spelled as content names it, so a site that builds on macOS or Windows builds on Linux
    if (existsExactly(dir, path.rel)) return { rel: path.rel, source }
  }
  return { refused: 'does not exist' }
}

/**
 * Why a page's URL path is not one, or undefined: it is `/` or `/segment/…/`, and no segment is `.` or `..`, holds
 * whitespace, a control character, a backslash or one of `? # % & " ' < > : * |`, ends in `.`, or is a name Windows
 * reserves for a device (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`, `com¹`–`com³`, `lpt¹`–`lpt³`,
 * also with an extension): the page's directory must be one on every system (docs/platforms.md).
 */
export function urlPathProblem(urlPath: string): string | undefined {
  if (!urlPath.startsWith('/') || !urlPath.endsWith('/')) return 'must start and end with /'
  if (urlPath === '/') return undefined
  const segments = urlPath.slice(1, -1).split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'has an empty, . or .. segment'
  }
  if (/[\x00-\x1f\x7f]/.test(urlPath)) return 'holds a control character'
  if (/[\s\\?#%&"'<>:*|]/.test(urlPath)) return 'holds whitespace or one of \\ ? # % & " \' < > : * |'
  if (segments.some((segment) => segment.endsWith('.'))) return 'has a segment that ends in .'
  if (segments.some((segment) => /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment))) {
    return 'has a segment Windows reserves for a device (con, prn, aux, nul, com1–com9, lpt1–lpt9, com¹–com³, lpt¹–lpt³)'
  }
  return undefined
}
