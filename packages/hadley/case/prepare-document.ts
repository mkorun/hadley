// case — frontmatter extraction, shared by parseDocument() and the post-patch
// integrity check (integrity.ts), which both need the exact same md/baseOffset
// split for a raw document. The title comes from the syntax tree (title.ts).

import { LimaError, parse as limaparse } from '@limaformat/lima'
import type { CaseOptions, ParseErrorInfo } from './types.ts'

/**
 * How hadley parses content. No text nests this deep, and memory grows with the square of the depth: a list of 450
 * levels took 660 MB, from a page of 200 KB. A page past it is a problem of the page.
 */
export const PARSE_OPTIONS = { errorRecovery: true, resourceBudget: { maxFrames: 128 } } as const

export interface PreparedDocument {
  md: string
  metadata: Record<string, any>
  baseOffset: number
  /** Why the front matter is not what it says: Lima rejected it (it is then empty), or it gives a field twice; a
   * published page fails on it. */
  frontMatterErrors?: ParseErrorInfo[]
}

export function prepareDocument(rawDoc: string, options: CaseOptions): PreparedDocument {
  // a byte order mark is not part of the text: the front matter starts after it, and so do the parser's offsets
  const bom = rawDoc.startsWith('\uFEFF') ? 1 : 0
  let md = rawDoc.slice(bom)

  /**
   * Extract frontmatter (Lima)
   */
  let frontMeta: Record<string, any> = {}
  let frontMatterError: ParseErrorInfo | undefined
  if (md.startsWith('<!---')) {
    // the form of an HTML comment is gone: the page says so rather than showing its front matter as text
    frontMatterError = { message: 'front matter: it stands between two lines of ---, not in <!--- … --->', start: bom }
  } else if (/^---[^\S\r\n]*\r?\n/u.test(md)) {
    // the closing line of --- is a whole line, as the opening one: `---x` is text of the front matter
    const frontMatter = md.match(/^(---[^\S\r\n]*\r?\n)(.*?)^---[^\S\r\n]*(\r?\n|$)/msu)
    if (!frontMatter) frontMatterError = { message: 'front matter: it has no closing line of ---', start: bom }
    if (frontMatter) {
      const [, opening = '', inner = '', lineEnd = ''] = frontMatter
      // the line end after the closing line stays the body's, as it always was
      md = md.slice(frontMatter[0].length - lineEnd.length)
      const text = inner.trim()
      try {
        // strict (Lima Core §10), as hadley reads every Lima file of a site (lib/site-config.ts)
        frontMeta = limaparse(text, {
          strict: true,
          ...(options.partials === undefined ? {} : { partials: options.partials }),
        })
      } catch (e) {
        // Bun gives every error a line of its own, of the JavaScript that threw it
        const line = e instanceof LimaError ? e.line : undefined
        // the error's line counts in `text`, which starts this far into the document
        const textStart = bom + opening.length + inner.indexOf(text)
        frontMatterError = {
          // Lima counts the line in the front matter; `start` places it in the document, and the problem names it
          message: `front matter: ${(e instanceof Error ? e.message : String(e)).replace(/ at line \d+/, '')}`,
          ...(typeof line === 'number' && line >= 1
            ? {
                start:
                  textStart +
                  text
                    .split('\n')
                    .slice(0, line - 1)
                    .join('\n').length +
                  (line > 1 ? 1 : 0),
              }
            : {}),
        }
      }
    }
  }

  // A key counts as it is spelled, in Unicode's composed form (NFC): a ü typed as u and a combining mark is the ü of
  // config.lima. Another name of a field (metadata.<field>.aliases) counts the same way; a field the front matter
  // gives twice, by its name and another, by two others or in two forms of one, keeps the first and is a fault
  const errors: ParseErrorInfo[] = frontMatterError ? [frontMatterError] : []
  const aliases = options.aliases ?? {}
  const givenAs = new Map<string, string>()
  // without a prototype, as Lima makes its maps: a key __proto__ stays a key
  const named: Record<string, any> = Object.create(null)
  for (const key of Object.keys(frontMeta)) {
    const composed = key.normalize('NFC')
    const field = Object.hasOwn(aliases, composed) ? aliases[composed]! : composed
    const first = givenAs.get(field)
    if (first !== undefined) {
      errors.push({
        message:
          first.normalize('NFC') === composed
            ? `front matter: ${key} is given twice, in two Unicode forms of one name; keep one`
            : `front matter: ${first} and ${key} are both the field ${field}; keep one`,
      })
      continue
    }
    givenAs.set(field, key)
    named[field] = frontMeta[key]
  }
  frontMeta = named

  const metadata: Record<string, any> = { ...frontMeta }

  /**
   * baseOffset = the length of the front matter before the body, so block.start and block.end point into rawDoc
   * directly (JS string indices in the whole file).
   */
  const baseOffset = rawDoc.length - md.length
  return { md, metadata, baseOffset, ...(errors.length > 0 ? { frontMatterErrors: errors } : {}) }
}

/** The defaults of the metadata schema, once the title is known. */
export function completeMetadata(metadata: Record<string, any>, options: CaseOptions): void {
  if (options.defaults) {
    for (const d of Object.keys(options.defaults)) {
      if (!metadata[d]) {
        metadata[d] = options.defaults[d]
      }
    }
  }
}
