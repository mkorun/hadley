/**
 * The front matter of a page, read once: the fields that place the page (template, type, urlPath, status), which stop
 * every build when they are not a text, and every other field, which is one hadley reads or one config.lima declares,
 * and of its kind. What is wrong with any of them is a problem of the page (lib/problems.ts).
 */
import type { Metadata } from './site.ts'
import type { FieldSchema } from './site-config.ts'

export const STATES = ['draft', 'seed', 'published', 'archived']
export const KNOWN_TYPES = new Set(['article', 'essay', 'note', 'page'])
const KNOWN_ARCHETYPES = new Set([
  'deep-dive',
  'case-study',
  'blueprint',
  'manifesto',
  'til',
  'heuristic',
  'snippet',
  'spark',
])
const TEXT_FIELDS = [
  'title',
  'subtitle',
  'linktext',
  'description',
  'htmlTitle',
  'category',
  'archetype',
  'coverStyle', // a style for the cover the theme may know (docs/themes.md, "Covers")
] as const
const DATE_FIELDS = ['publishFrom', 'updatedAt'] as const
const FLAG_FIELDS = ['ai_assisted', 'noindex'] as const
// the fields hadley reads; a page may have another only when config.lima declares it (metadata.<field>), for its theme
const HADLEY_FIELDS: ReadonlySet<string> = new Set([
  ...TEXT_FIELDS,
  ...DATE_FIELDS,
  ...FLAG_FIELDS,
  'tags',
  'author',
  'vgwort_pixel',
  'cover',
  'og:image',
])
/** What hadley gives a template in meta itself (lib/page-context.ts): no page sets it, config.lima declares none. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(['lang', 'charset', 'id'])
// the fields that place a page out (readFrontMatter), which leave meta
const PLACEMENT_FIELDS: ReadonlySet<string> = new Set(['template', 'type', 'urlPath', 'status', 'sitemap', 'markdown'])

/** Whether `name` is a field hadley knows by that name, which no other field may take as another name. */
export const isHadleyField = (name: string): boolean =>
  HADLEY_FIELDS.has(name) || RESERVED_FIELDS.has(name) || PLACEMENT_FIELDS.has(name)

/** What the front matter of a page says, and what is wrong with it. */
export interface FrontMatter {
  // the fields that place the page, when it sets them
  template?: string
  type?: string
  urlPath?: string
  status?: string
  inSitemap: boolean // sitemap: false leaves the page out of sitemap.xml
  inMarkdown: boolean // markdown: false leaves out the page's Markdown twin
  metadata: Metadata
  faults: Fault[]
}

/** What is wrong with the front matter, and the field it is about, which names its line (lib/lines.ts). */
export type Fault = { message: string; field?: string }

/**
 * Reads `front` (case's metadata of the page at `file`, aliases applied): takes the fields that place the page out,
 * and checks the rest (checkMetadata). A field that places the page and is not a text stops every build.
 */
export function readFrontMatter(front: Record<string, unknown>, schema: FieldSchema, file: string): FrontMatter {
  const fields = { ...front }
  const faults: Fault[] = []
  // a value config.lima does not allow (metadata.<field>.allowed), a typo such as category: hadly
  for (const [field, allowed] of Object.entries(schema.allowed)) {
    const value = fields[field]
    if (value !== undefined && !allowed.includes(value)) {
      faults.push({
        message: `the front matter field ${field} is ${JSON.stringify(value)}, not one of ${allowed.join(', ')} (config.lima)`,
        field,
      })
    }
  }
  const placement = (field: 'template' | 'type' | 'urlPath' | 'status'): string | undefined => {
    const value = fields[field]
    delete fields[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') throw new Error(`${file}: the front matter field ${field} is not a text`)
    return value
  }
  const template = placement('template')
  const type = placement('type')
  const urlPath = placement('urlPath')
  const status = placement('status')
  const { sitemap } = fields
  delete fields.sitemap
  if (sitemap !== undefined && sitemap !== null && typeof sitemap !== 'boolean') {
    faults.push({ message: 'the front matter field sitemap is not true or false', field: 'sitemap' })
  }
  const { markdown } = fields
  delete fields.markdown
  if (markdown !== undefined && markdown !== null && typeof markdown !== 'boolean') {
    faults.push({ message: 'the front matter field markdown is not true or false', field: 'markdown' })
  }
  const metadata = checkMetadata(fields, faults, schema.declared)
  for (const field of schema.required) {
    if (!metadata[field]) faults.push({ message: `the front matter field ${field} is required (config.lima)` })
  }
  if (metadata.publishFrom && metadata.updatedAt && metadata.updatedAt < metadata.publishFrom) {
    faults.push({ message: 'its updatedAt is before its publishFrom', field: 'updatedAt' })
  }
  if (metadata.archetype && !KNOWN_ARCHETYPES.has(metadata.archetype)) {
    faults.push({
      message: `its archetype ${metadata.archetype} is not one of ${[...KNOWN_ARCHETYPES].join(', ')}`,
      field: 'archetype',
    })
  }
  return {
    ...(template !== undefined ? { template } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(urlPath !== undefined ? { urlPath } : {}),
    ...(status !== undefined ? { status } : {}),
    inSitemap: sitemap !== false,
    inMarkdown: markdown !== false,
    metadata,
    faults,
  }
}

/**
 * The fields of the front matter, checked once: each is one hadley reads or one config.lima declares (`declared`),
 * and of its kind: a text is a text, a date a date (LIMA reads one as a Date, a quoted one stays a text that must
 * parse), tags one text or a list of them, a flag true or false. An empty field is left out. Any other field, and a
 * field of another kind, is a problem of the page, as a parse error is, and left out.
 */
function checkMetadata(raw: Record<string, unknown>, problems: Fault[], declared: ReadonlySet<string>): Metadata {
  const metadata: Record<string, unknown> = { ...raw }
  for (const field of Object.keys(metadata)) {
    if (RESERVED_FIELDS.has(field)) {
      const why = field === 'lang' ? ': a page is in the language of the folder its file is in' : ''
      problems.push({ message: `the front matter field ${field} is one hadley sets itself${why}`, field })
      delete metadata[field]
    } else if (!HADLEY_FIELDS.has(field) && !declared.has(field)) {
      problems.push({
        message: `the front matter field ${field} is neither one hadley reads nor one config.lima declares`,
        field,
      })
      delete metadata[field]
    }
  }
  const wrong = (field: string, what: string) => {
    // LIMA reads 1984 or true unquoted as a number or a flag, which a title may well be meant as
    const scalar = typeof metadata[field] === 'number' || typeof metadata[field] === 'boolean'
    problems.push({
      message: `the front matter field ${field} is not ${what}${scalar ? ' (in quotes, it is a text)' : ''}`,
      field,
    })
    delete metadata[field]
  }
  for (const [field, value] of Object.entries(metadata)) if (value === null) delete metadata[field]
  for (const field of TEXT_FIELDS) {
    if (field in metadata && typeof metadata[field] !== 'string') wrong(field, 'a text')
  }
  for (const field of DATE_FIELDS) {
    const value = metadata[field]
    if (value === undefined || value instanceof Date) continue
    const date = typeof value === 'string' ? new Date(value) : undefined
    if (date && !Number.isNaN(date.getTime())) metadata[field] = date
    else wrong(field, 'a date')
  }
  for (const field of FLAG_FIELDS) {
    if (field in metadata && typeof metadata[field] !== 'boolean') wrong(field, 'true or false')
  }
  const { tags, vgwort_pixel: pixel, author } = metadata
  if (typeof tags === 'string') metadata.tags = [tags]
  else if (tags !== undefined && !(Array.isArray(tags) && tags.every((tag) => typeof tag === 'string')))
    wrong('tags', 'a text or a list of texts')
  if (typeof pixel === 'number') metadata.vgwort_pixel = String(pixel)
  else if (pixel !== undefined && typeof pixel !== 'string') wrong('vgwort_pixel', 'a text')
  const authorName = author !== null && typeof author === 'object' ? (author as { name?: unknown }).name : undefined
  if (author !== undefined && typeof author !== 'string' && !(typeof author === 'object' && authorName !== null))
    wrong('author', 'a text or a person')
  else if (authorName !== undefined && typeof authorName !== 'string') wrong('author', 'a person with a name')
  if (metadata.title === undefined) {
    problems.push({ message: 'has no title (in the front matter or as a first # heading)' })
    metadata.title = ''
  }
  return metadata as Metadata
}
