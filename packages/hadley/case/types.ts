// ─── Editor Block Reference ───────────────────────────────────────────────────

/**
 * A top-level (or footnote) block for the block editor (addons/editor): its type and its source range, nothing else.
 * `type` is the Markanto AST node's own name ('paragraph', 'imageBlock', 'horizontalRule', 'codeBlock', …), not a
 * vocabulary of hadley's. The renderer (`markanto-native-renderer.ts`) fills in {type, start, end} only. Its one user
 * is `addons/editor/renderer.ts` (`.type === 'paragraph'` for what may be merged, `.start`/`.end` for the block ids).
 */
export interface BlockToken {
  type: string
  // JavaScript string indices (UTF-16 code units) into the file, from Markanto's SourceRange; as
  // String.prototype.slice() takes them.
  start: number // front matter included (shifted by baseOffset): the block's first character
  end: number // exclusive: the position after the block's closing \n
}

// ─── Parser Result ────────────────────────────────────────────────────────────

export interface TocEntry {
  id: string
  level: number
  text: string // plain text, as the heading shows it (with typography on, typographic)
}

export interface Annotation {
  type: string
  href: string
  text?: string
}

// ─── Files content names ──────────────────────────────────────────────────────

/**
 * A file the content of a page names, as the renderer meets it (fileRequests) and readDestination reads it. `node`
 * is the tree node that names it; the renderer finds what was built for it by that node. `destination` is as the
 * content writes it; `rel` (a file of the bundle) and `path` (from the site's root) are decoded, `suffix` is the
 * query and fragment the URL keeps.
 *
 *   image   a bundle image built in several widths with the image config `config` (none: "default")
 *   native  a bundle image copied as it is (`<m data-size=native>`)
 *   copy    a bundle file copied as it is: a resource, a video or audio file, or an image sized by its `<m>`
 *   path    a site path: a page (ending in `/`) or a file in the build's plan, which must be one
 *   refused a destination named where nothing can show it, or one readDestination refuses, or a page id that names
 *           no page, for `reason`: it fails a published page, a draft shows why
 */
export type FileRequest =
  | {
      node: object
      kind: 'image' | 'native' | 'copy'
      destination: string
      rel: string
      suffix: string
      config?: string
    }
  | { node: object; kind: 'path'; destination: string; path: string; suffix: string; href: string } // href: resolved
  | { node: object; kind: 'refused'; destination: string; reason: string }

/** An image built in several widths, as a figure and the cover write it. */
export interface Picture {
  src: string // the smallest width in the first format
  width: number
  height: number
  sizes: string
  sources: ReadonlyArray<{ type: string; srcset: string }>
}

/** How an AI-generated image is labelled (from the locale). */
export interface AiLabel {
  badge: string
  altSuffix: string
}

/**
 * What was built for a file of the content, with the URL the page writes for it: relative to the page for a bundle
 * file, from the site's root for a theme file. On a draft, a file that could not be built is `failed`.
 *
 *   picture  an image built in several widths
 *   native   an image copied as it is
 *   file     any other bundle file copied as it is, or a theme file that exists
 */
export type Built =
  | { kind: 'picture'; picture: Picture; ai?: AiLabel }
  | { kind: 'native'; href: string; width?: number; height?: number; ai?: AiLabel }
  | { kind: 'file'; href: string }
  | { kind: 'failed'; reason: string }

/**
 * One `parse()` error/warning diagnostic, reduced to what a consumer needs.
 * `start`/`end` are file-absolute JS-string indices (baseOffset-adjusted) —
 * the same coordinate space as `BlockToken.start`/`.end`, so a caller can test
 * overlap with an edited block directly. Present whenever the underlying
 * `Diagnostic.range` was set (markanto-js ≥0.1.1); a diagnostic can still omit
 * it (e.g. a resource-budget diagnostic has no single offending span).
 */
export interface ParseErrorInfo {
  message: string
  start?: number
  end?: number
}

/** A heading of the content, as the theme's heading template gets it (RenderOptions.heading). */
export interface Heading {
  level: number
  id: string | undefined
  html: string // its content, as hadley writes it
}

// ─── Render Options (internal) ─────────────────────────────────────────────────

export interface RenderOptions {
  bundlePath: string // absolute path to the content bundle dir
  urlPath: string // the page's URL path, which a relative destination resolves against (`/`, `/a/`, `/en/a/`)
  origin?: string // the site's origin: an absolute URL on it is a site path, not an external URL
  lang?: string // e.g. 'de', 'en' — needed for typography and for links to other pages ($id)
  typography?: boolean // typographic quotes, dashes and ellipses in prose (config.lima `typography.enabled`)
  // Translation mappings for [$page-id] links: { pageId: { lang: '/url-path/' } }
  // Comes from load-site.ts (site.translationMappings); optional for Phase 3 tests.
  translationMappings?: Record<string, Record<string, string>>
  // IDs of pages that are draft/seed/archived — used to mark links to unpublished pages.
  unpublishedIds?: Set<string>
  // A link to an unpublished page becomes its text (publish) instead of being marked data-link-unpublished (dev).
  unlinkUnpublished?: boolean
  // What a heading holds, written by the theme (templates/markup/heading.sort): given the heading's level, id and
  // content as HTML; its own tag and id stay hadley's. Without, the heading holds its content as it is.
  heading?: (heading: Heading) => string
  // What was built for each file the content names, by its node (fileRequests); needed for a page with one.
  files?: ReadonlyMap<object, Built>
  // Block editor hooks (dev mode only) — inject data-hadley-id into rendered HTML
  getBlockId?: (start: number) => string | undefined
  onBlocks?: (blocks: BlockToken[]) => void
}

// ─── Case Options + Result ────────────────────────────────────────────────────

export interface CaseOptions extends Omit<RenderOptions, 'bundlePath' | 'urlPath'> {
  bundlePath?: string // optional: only needed when content contains bundle images
  urlPath?: string // optional for extract(), which places a page without one at `/`
  // Metadata schema options (from config.lima via load-site.ts):
  partials?: Record<string, any>
  defaults?: Record<string, any>
  aliases?: Record<string, string>
}

export interface CaseResult {
  html: string
  toc: TocEntry[]
  annotations: Annotation[]
  externalLinks: string[]
  // attributes of content left out of the output: data-* names hadley reserves for itself
  ignoredAttributes: string[]
  // The page's text as a reader reads it, for its character count and description: without image and media
  // captions, footnotes, :::nocount blocks and editor comments; whitespace collapsed.
  bodyText: string
  // Non-empty when the parser fell back to error-recovery (status 'invalid').
  parseErrors?: ParseErrorInfo[]
  tldr?: string
  metadata: Record<string, any>
}
