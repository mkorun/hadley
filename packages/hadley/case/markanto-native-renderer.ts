import { highlightCode } from './highlighter.ts'
import type {
  Block,
  Document,
  DocumentBlock,
  ErrorBlock,
  Grid,
  Inline,
  ListItem,
  ParseResult,
  RecoveryDocument,
  SourceAnnotations,
} from '@markantolang/parser'
import type { Annotation, BlockToken, Built, CaseResult, FileRequest, RenderOptions, TocEntry } from './types.ts'
import { attrs, escHtml, pictureHtml, startTag, type Attrs } from './html.ts'
import { transformText, typographyState, type TypographyState } from './typography.ts'
import {
  readDestination,
  resourceConfigAttr,
  sizesInline,
  treeOf,
  type Destination,
  type ResourceAttributes,
  type Use,
} from './destination.ts'

// data-* names hadley writes itself; content cannot set them, so no element can carry one twice.
// Nor any of Pagefind's, which would let a page change what the site's search shows and filters (isReserved)
const RESERVED_DATA = new Set([
  'hadley-id',
  'sized',
  'ai-generated',
  'ai-label',
  'link-unpublished',
  'nocount',
  'align',
  'row-span',
  'col-span',
])

const isReserved = (key: string) => RESERVED_DATA.has(key) || key.startsWith('pagefind')

const SIZING_DATA = new Set(['size', 'style'])

/**
 * The data-* attributes of content, checked: a destination-shaped value (…href, …src, …url, …link) is read as one and
 * written resolved, or refused; a name hadley reserves is left out. Both are reported. Keys in `omit` are left out
 * silently (they are rendered elsewhere).
 */
function contentData(
  attrs: Pick<ResourceAttributes, 'dataAttrs'> | undefined,
  ctx: Ctx,
  omit: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs?.dataAttrs ?? {})) {
    if (omit.has(key)) continue
    if (isReserved(key)) {
      ctx.ignoredAttributes.push(`data-${key}`)
      continue
    }
    if (!/(?:href|src|url|link)$/.test(key)) {
      data[key] = value
      continue
    }
    const read = readOf(ctx, value, 'data')
    if (read.kind === 'refused') refused(ctx, attrs!, value, read.reason)
    else if (read.kind !== 'bundle') data[key] = read.href
  }
  return data
}

function dataAttrs(data: Record<string, string>): Attrs {
  return Object.entries(data).map(([key, value]) => [`data-${key}`, value] as const)
}

/** lang and the checked data-* of content, in that order. */
function contentAttrs(
  attrs: Pick<ResourceAttributes, 'lang' | 'dataAttrs'> | undefined,
  ctx: Ctx,
  omit: ReadonlySet<string> = new Set(),
): Attrs {
  return [['lang', attrs?.lang || undefined], ...dataAttrs(contentData(attrs, ctx, omit))]
}

function sizingAttrs(attrs?: ResourceAttributes): Attrs {
  return [
    ['data-size', attrs?.dataAttrs?.size],
    ['data-style', attrs?.dataAttrs?.style],
  ]
}

// What an image's <m> carries for the image pipeline: lang and the checked data-* (including size and style).
// Markanto 0.1.0 lets a kindless <m> attach such metadata to an image, so it stays on the image.
function imageMeta(attrs: ResourceAttributes | undefined, ctx: Ctx): { lang?: string; data?: Record<string, string> } {
  const data = contentData(attrs, ctx)
  return {
    ...(attrs?.lang ? { lang: attrs.lang } : {}),
    ...(Object.keys(data).length ? { data } : {}),
  }
}

/** The attributes an image's <m> gives its figure (or img): data-size, data-style, lang, then the other data-*. */
function metaAttrs(meta: { lang?: string; data?: Record<string, string> }, sizing = true): Attrs {
  const { size, style, ...other } = meta.data ?? {}
  return [
    ['data-size', sizing ? size : undefined],
    ['data-style', sizing ? style : undefined],
    ['lang', meta.lang],
    ...dataAttrs(other),
  ]
}

const LAZY: Attrs = [
  ['loading', 'lazy'],
  ['decoding', 'async'],
]

// A native-size image's title `640` or `640x480` sets its size instead of captioning it.
const DIMENSIONS = /^(\d+)(?:x(\d+))?$/

// What the renderer asks lib to build for a destination: a file of the bundle (copied, or an image) or a site path.
type Wanted =
  | { kind: 'image' | 'native' | 'copy'; rel: string; suffix: string; config?: string | undefined }
  | { kind: 'path'; path: string; suffix: string; href: string }

/**
 * Names a file the content shows. Recording (fileRequests), the renderer notes each request once per node; that list
 * is what lib builds, so every file a page shows is one the renderer asked for.
 */
function request(ctx: Ctx, node: object, destination: string, wanted: Wanted): void {
  if (!ctx.requests || ctx.requested.has(node)) return
  ctx.requested.add(node)
  if (wanted.kind === 'path') ctx.requests.push({ node, destination, ...wanted })
  else {
    const { config, ...file } = wanted
    ctx.requests.push({ node, destination, ...file, ...(config !== undefined ? { config } : {}) })
  }
}

/** A destination the content names where nothing can show it: it fails a published page, and a draft shows why. */
function refused(ctx: Ctx, node: object, destination: string, reason: string): string {
  if (ctx.requests && !ctx.requests.some((ref) => ref.node === node && ref.destination === destination)) {
    ctx.requested.add(node)
    ctx.requests.push({ node, kind: 'refused', destination, reason })
  }
  return notBuilt(`${destination} ${reason}`)
}

// While recording, every file is built: the renderer takes the path a page takes whose files all exist.
const RECORDED: Record<Exclude<FileRequest['kind'], 'refused'>, Built> = {
  image: { kind: 'picture', picture: { src: '', width: 0, height: 0, sizes: '', sources: [] } },
  native: { kind: 'native', href: '' },
  copy: { kind: 'file', href: '' },
  path: { kind: 'file', href: '' },
}

/**
 * What was built for a file the content names; the recording named every one, so a missing entry is a fault in
 * hadley. The renderer writes a bundle or theme file's URL only from here, never from the destination as written.
 */
function built(ctx: Ctx, node: object, destination: string, wanted: Wanted): Built {
  request(ctx, node, destination, wanted)
  if (ctx.requests) return RECORDED[wanted.kind]
  const file = ctx.options.files?.get(node)
  if (!file) throw new Error(`nothing built for ${destination}: it was not requested when its page was recorded`)
  return file
}

/** The comment a draft shows in place of a file that could not be built. */
function notBuilt(reason: string): string {
  return `<!-- not built: ${escHtml(reason).replace(/--/g, '- -')} -->`
}

/** The URL of a copied bundle file or a site file the content names, or why a draft has none. */
function fileHref(ctx: Ctx, node: object, destination: string, wanted: Wanted): { href: string } | { failed: string } {
  const file = built(ctx, node, destination, wanted)
  if (file.kind === 'failed') return { failed: file.reason }
  if (file.kind !== 'file') throw new Error(`${destination} was built as an image, not as a file`)
  return { href: file.href }
}

/**
 * The URL a destination is written with (readDestination): as read for this page or an external URL, from what was
 * built for a file; a bundle file is copied as it is. A refused one fails a published page.
 */
function destinationHref(
  ctx: Ctx,
  node: object,
  destination: string,
  read: Destination,
): { href: string } | { failed: string } {
  switch (read.kind) {
    case 'self':
    case 'external':
      return { href: read.href }
    case 'refused':
      refused(ctx, node, destination, read.reason)
      return { failed: `${destination} ${read.reason}` }
    case 'bundle':
      return fileHref(ctx, node, destination, { kind: 'copy', rel: read.rel, suffix: read.suffix })
    case 'path':
      return fileHref(ctx, node, destination, { kind: 'path', path: read.path, suffix: read.suffix, href: read.href })
  }
}

const readOf = (ctx: Ctx, destination: string, use: Use): Destination =>
  readDestination(destination, use, ctx.options.urlPath, ctx.options.origin)

/**
 * A bundle image from what was built for it: a figure with a picture, or a native-size img (a figure when captioned),
 * or a visible comment on a draft whose image could not be built. A caption is rendered HTML; a title is prose.
 */
function bundleImageHtml(
  file: Built,
  image: { alt: string; title: string | undefined; caption: string | undefined },
  meta: { lang?: string; data?: Record<string, string> },
  ctx: Ctx,
  sizing = true,
): string {
  if (file.kind === 'failed') return notBuilt(file.reason)
  if (file.kind === 'file') throw new Error(`an image was built as a file: ${file.href}`)
  const alt = file.ai && image.alt ? `${image.alt} ${file.ai.altSuffix}` : image.alt
  if (file.kind === 'native') {
    const dim = image.title ? DIMENSIONS.exec(image.title) : null
    const img: Attrs = [
      ['src', file.href],
      ['alt', alt],
      ['width', dim ? dim[1] : file.width || undefined],
      ['height', dim ? dim[2] : file.height || undefined],
      ['data-sized', dim ? true : undefined],
    ]
    const caption = image.caption ?? (!dim && image.title ? text(image.title, ctx) : undefined)
    return caption
      ? `${startTag('figure', metaAttrs(meta))}\n${startTag('img', [...img, ...LAZY])}\n<figcaption>${caption}</figcaption>\n</figure>`
      : startTag('img', [...img, ...metaAttrs(meta), ...LAZY])
  }
  const caption = image.caption ?? (image.title ? text(image.title, ctx) : undefined)
  const figure = startTag('figure', [
    ...metaAttrs(meta, sizing),
    ['data-ai-generated', file.ai ? true : undefined],
    ['data-ai-label', file.ai?.badge],
  ])
  const figcaption = caption ? `\n<figcaption>${caption}</figcaption>` : ''
  return `${figure}\n${pictureHtml(file.picture, alt, LAZY)}${figcaption}\n</figure>`
}

/** The plain text of inline content, as an attribute or a title takes it. */

/** The page's language, which typography and a link to another page ($id) need; without one the render stops. */
function languageOf(options: RenderOptions): string {
  if (!options.lang) throw new Error('render: lang is missing, which typography and links to other pages ($id) need')
  return options.lang
}

export function extractText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
        case 'inlineMath':
          return node.value
        case 'softBreak':
        case 'hardBreak':
          return ' '
        case 'inlineImage':
          return extractText(node.alt)
        case 'footnoteReference':
          return ''
        case 'autolink':
          return node.value
        case 'sup':
        case 'sub':
          return node.value
        default:
          return extractText(node.children)
      }
    })
    .join('')
}

interface Ctx {
  options: RenderOptions
  baseOffset: number
  toc: TocEntry[]
  annotations: Annotation[]
  externalLinks: string[]
  ignoredAttributes: string[]
  tldr?: string
  noteRefCounts: Map<string, number>
  noteRefSeen: Map<string, number>
  annotationsSource: SourceAnnotations
  slugs: Map<object, string>
  typography?: TypographyState
  // The page's text as a reader reads it, for its character count: off in captions, footnotes and :::nocount.
  bodyText: string
  counting: boolean
  // The text of the heading being rendered, for its table-of-contents entry.
  headingText?: string | undefined
  // Recording (fileRequests): the files the content names, in the order the renderer meets them.
  requests?: FileRequest[]
  requested: Set<object>
}

function makeCtx(
  options: RenderOptions,
  baseOffset: number,
  annotationsSource: SourceAnnotations,
  slugs: Map<object, string>,
  requests: FileRequest[] | undefined,
): Ctx {
  return {
    options,
    baseOffset,
    toc: [],
    annotations: [],
    externalLinks: [],
    ignoredAttributes: [],
    noteRefCounts: new Map(),
    noteRefSeen: new Map(),
    annotationsSource,
    slugs,
    ...(options.typography ? { typography: typographyState(languageOf(options)) } : {}),
    bodyText: '',
    counting: true,
    ...(requests ? { requests } : {}),
    requested: new Set(),
  }
}

/**
 * Prose as HTML: with typography on, its punctuation becomes typographic; then it is escaped. Code, URLs and source
 * text are written with escHtml instead. The quote state runs on through the document, and so does the character
 * before: an apostrophe right after an inline element (`*girls*'`) follows its last letter, while one at the start of
 * a block, a table cell or a line opens a quote (textBreak).
 */
function text(value: string, ctx: Ctx): string {
  if (!ctx.typography) return shown(value, ctx)
  const typographic = transformText(value, ctx.typography)
  read(typographic, ctx)
  return escHtml(typographic)
}

/** Text the page shows as it is written, such as code or a URL, as HTML. It is part of the page's text. */
function shown(value: string, ctx: Ctx): string {
  read(value, ctx)
  if (ctx.typography && value) ctx.typography.lastChar = value.at(-1)!
  return escHtml(value)
}

function read(value: string, ctx: Ctx): void {
  if (ctx.counting) ctx.bodyText += value
  if (ctx.headingText !== undefined) ctx.headingText += value
}

/** Where a reader's text breaks: between blocks, table cells and at a line break. */
function textBreak(ctx: Ctx): void {
  if (ctx.counting) ctx.bodyText += ' '
  if (ctx.typography) ctx.typography.lastChar = ' '
}

/** Renders what does not count as the page's text: a caption, a footnote, a :::nocount block. */
function uncounted<T>(ctx: Ctx, render: () => T): T {
  const counting = ctx.counting
  ctx.counting = false
  const result = render()
  ctx.counting = counting
  return result
}

function countNoteRefsInline(nodes: readonly Inline[], counts: Map<string, number>): void {
  for (const node of nodes) {
    if (node.type === 'footnoteReference') {
      counts.set(node.identifier, (counts.get(node.identifier) ?? 0) + 1)
    } else if ('children' in node) {
      countNoteRefsInline(node.children, counts)
    }
  }
}

function walkBlockInline(block: Block | Grid | ErrorBlock, visit: (nodes: readonly Inline[]) => void): void {
  switch (block.type) {
    case 'errorBlock':
      break
    case 'heading':
    case 'paragraph':
    case 'footnoteDefinition':
      visit(block.children)
      break
    case 'imageBlock':
    case 'videoBlock':
    case 'audioBlock':
    case 'embedBlock':
    case 'downloadBlock':
      if (block.type === 'imageBlock') visit(block.alt)
      else visit(block.label)
      if (block.caption) visit(block.caption)
      break
    case 'list':
      for (const item of block.items) for (const child of item.children) walkBlockInline(child, visit)
      break
    case 'table':
      for (const cell of block.head.cells) visit(cell.children)
      for (const row of block.body) for (const cell of row.cells) visit(cell.children)
      break
    case 'grid':
      for (const row of [...(block.header ?? []), ...block.rows]) {
        for (const cell of row.cells) for (const child of cell.children) walkBlockInline(child, visit)
      }
      break
    case 'quoteRegion':
      for (const child of block.children) walkBlockInline(child.block, visit)
      if (block.attribution) visit(block.attribution)
      break
    case 'container':
      for (const child of block.children) walkBlockInline(child, visit)
      break
  }
}

// Adjacent text and soft breaks form one run of prose, so typography sees `--` or a quote across them.
function renderInline(nodes: readonly Inline[], ctx: Ctx): string {
  let html = ''
  let run = ''
  nodes.forEach((node, index) => {
    if (node.type === 'text') {
      run += node.value
      return
    }
    if (node.type === 'softBreak') {
      run += ' '
      return
    }
    // Markanto stores inter-token whitespace before a footnote reference only
    // in SourceRange. Preserve it for Hadley's byte-level rendering contract.
    const previous = nodes[index - 1]
    const previousRange = previous ? ctx.annotationsSource.forNode(previous)?.range : undefined
    const range = ctx.annotationsSource.forNode(node)?.range
    if (node.type === 'footnoteReference' && previousRange && range && previousRange.end.offset < range.start.offset)
      run += ' '
    if (run) html += text(run, ctx)
    run = ''
    html += renderInlineNode(node, ctx)
  })
  return run ? html + text(run, ctx) : html
}

function renderInlineImage(
  node: Extract<Inline, { type: 'inlineImage' }>,
  ctx: Ctx,
  spanAttrs?: ResourceAttributes,
): string {
  const src = node.src
  const read = readOf(ctx, src, 'resource')
  // In Markanto 0.1.0 an <m data-*> with no other child than an image collapses into an InlineImage with its own
  // `attrs`; there is no span around it. So data-size and data-style can sit on the wrapper (spanAttrs) OR on the
  // image node itself.
  const sizing = spanAttrs ?? node.attrs
  // An inline image sized by <m data-size/data-style> stays in the text as a plain <img>, and a bundle file is only
  // copied: <figure><picture> would be invalid inside text.
  if (sizesInline(sizing)) {
    const file = destinationHref(ctx, node, src, read)
    if ('failed' in file) return notBuilt(file.failed)
    return startTag('img', [
      ['src', file.href],
      ['alt', extractText(node.alt)],
      ['title', node.title || undefined],
      ...sizingAttrs(sizing),
      ...contentAttrs(sizing, ctx, SIZING_DATA),
    ])
  }
  const alt = extractText(node.alt)
  const meta = imageMeta(node.attrs, ctx)
  if (read.kind === 'bundle') {
    const image = { alt, title: node.title || undefined, caption: undefined }
    return bundleImageHtml(
      built(ctx, node, src, { kind: 'image', rel: read.rel, suffix: read.suffix }),
      image,
      meta,
      ctx,
    )
  }
  const file = destinationHref(ctx, node, src, read)
  if ('failed' in file) return notBuilt(file.failed)
  return startTag('img', [
    ['src', file.href],
    ['alt', alt],
    ['title', node.title || undefined],
    ['lang', meta.lang],
    ...dataAttrs(meta.data ?? {}),
  ])
}

function renderInlineNode(node: Inline, ctx: Ctx): string {
  switch (node.type) {
    case 'text':
      return text(node.value, ctx)
    case 'em':
      return `<em>${renderInline(node.children, ctx)}</em>`
    case 'strong':
      return `<strong>${renderInline(node.children, ctx)}</strong>`
    case 'deletion':
      return `<del>${renderInline(node.children, ctx)}</del>`
    case 'obsolete':
      return `<s>${renderInline(node.children, ctx)}</s>`
    case 'insert':
      return `<ins>${renderInline(node.children, ctx)}</ins>`
    case 'mark':
      return `<mark>${renderInline(node.children, ctx)}</mark>`
    case 'sup':
      return `<sup>${text(node.value, ctx)}</sup>`
    case 'sub':
      return `<sub>${text(node.value, ctx)}</sub>`
    case 'inlineCode':
      return `<code>${shown(node.value, ctx)}</code>`
    case 'inlineMath':
      return `${startTag('code', [['class', 'math']])}${shown(node.value, ctx)}</code>`
    case 'softBreak':
      return text(' ', ctx)
    case 'hardBreak':
      textBreak(ctx)
      return '<br>'
    case 'inlineImage':
      return uncounted(ctx, () => renderInlineImage(node, ctx))
    case 'autolink': {
      // an autolink is an absolute URL by its syntax
      const read = readOf(ctx, node.kind === 'email' ? `mailto:${node.value}` : node.value, 'link')
      if (read.kind !== 'external') {
        const reason = read.kind === 'refused' ? read.reason : 'is not an absolute URL'
        return `${shown(node.value, ctx)}${refused(ctx, node, node.value, reason)}`
      }
      if (node.kind === 'email') return `${startTag('a', [['href', read.href]])}${shown(node.value, ctx)}</a>`
      ctx.externalLinks.push(read.href)
      const external = startTag('a', [
        ['href', read.href],
        ['target', '_blank'],
        ['rel', 'noopener noreferrer'],
      ])
      return `${external}${shown(node.value, ctx)}</a>`
    }
    case 'footnoteReference': {
      const seen = (ctx.noteRefSeen.get(node.identifier) ?? 0) + 1
      ctx.noteRefSeen.set(node.identifier, seen)
      const suffix = seen > 1 ? `-${seen}` : ''
      const ref = startTag('a', [
        ['class', 'note-ref'],
        ['id', `note-${node.identifier}-ref${suffix}`],
        ['href', `#note-${node.identifier}`],
      ])
      // a marker, not text
      return `${ref}${escHtml(node.identifier)}</a>`
    }
    case 'metadataSpan': {
      const image =
        node.children.length === 1 && node.children[0]?.type === 'inlineImage' ? node.children[0] : undefined
      if (image === undefined || !sizesInline(node.attrs))
        return `${startTag('span', contentAttrs(node.attrs, ctx))}${renderInline(node.children, ctx)}</span>`
      // renderInlineImage puts lang and every data-* of the <m> on the <img>; the <span> wrapper is not needed.
      return uncounted(ctx, () => renderInlineImage(image, ctx, node.attrs))
    }
    case 'link':
      return renderLink(node, ctx)
  }
}

function renderLink(node: Extract<Inline, { type: 'link' }>, ctx: Ctx): string {
  let href = node.href
  let unpublished = false
  // a download (<m download> in the text) is a resource like the download block: a file, never a page
  const use = node.download ? 'resource' : 'link'
  const pageLink = use === 'link' && href.startsWith('$')
  if (pageLink) {
    const raw = href.slice(1)
    const hash = raw.indexOf('#')
    const pageId = hash === -1 ? raw : raw.slice(0, hash)
    const fragment = hash === -1 ? '' : raw.slice(hash)
    const lang = languageOf(ctx.options)
    const versions = ctx.options.translationMappings?.[pageId]
    const resolved = versions?.[lang]
    href = resolved ? resolved + fragment : href
    if (ctx.options.unpublishedIds?.has(pageId)) unpublished = true
    // a page id that names no page of this language fails a published page, as a missing file does
    else if (!resolved) {
      const reason = versions ? `names a page with no version in ${lang}` : 'names no page'
      const children = node.children.length ? renderInline(node.children, ctx) : shown(href, ctx)
      return `${children}${refused(ctx, node, href, reason)}`
    }
  }
  const children = node.children.length ? renderInline(node.children, ctx) : shown(href, ctx)
  // a page without a version to link stays its text, as in a publish build
  if (unpublished && (ctx.options.unlinkUnpublished || href.startsWith('$'))) return children
  // a page link is now the URL path load-site gave the page, read and checked like any other
  const read = readOf(ctx, href, use)
  const file = destinationHref(ctx, node, href, read)
  if ('failed' in file) return `${children}${notBuilt(file.failed)}`
  const external = read.kind === 'external' && (read.scheme === 'http:' || read.scheme === 'https:')
  if (external) ctx.externalLinks.push(file.href)
  const anchor = startTag('a', [
    ['href', file.href],
    ['title', node.title || undefined],
    ['target', external ? '_blank' : undefined],
    ['rel', external ? 'noopener noreferrer' : undefined],
    ['data-link-unpublished', unpublished || undefined],
    ['download', node.download || undefined],
    ...contentAttrs(node.attrs, ctx),
  ])
  return `${anchor}${children}</a>`
}

function blockDhi(block: object, ctx: Ctx, topLevel: boolean): Attrs {
  const range = ctx.annotationsSource.forNode(block)?.range
  if (!topLevel || !ctx.options.getBlockId || !range) return []
  return [['data-hadley-id', ctx.options.getBlockId(ctx.baseOffset + range.start.offset) || undefined]]
}

type RenderBlock = Block | Grid | ErrorBlock

function renderBlocks(blocks: readonly RenderBlock[], ctx: Ctx, topLevel = false): string {
  const out: string[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    const groupId = block.type === 'imageBlock' ? block.attrs?.group : undefined
    if (groupId !== undefined) {
      let j = i + 1
      while (
        j < blocks.length &&
        blocks[j].type === 'imageBlock' &&
        (blocks[j] as Extract<DocumentBlock, { type: 'imageBlock' }>).attrs?.group === groupId
      )
        j++
      const group = blocks.slice(i, j) as Extract<DocumentBlock, { type: 'imageBlock' }>[]
      textBreak(ctx)
      out.push(uncounted(ctx, () => renderImageGroup(group, ctx)))
      i = j
      continue
    }
    out.push(renderBlock(block, ctx, topLevel))
    i++
  }
  return out.filter(Boolean).join('\n')
}

// Makes one image group of a run of <m group=X> images; X picks the image config. Only bundle images are grouped; an
// external or site image with a group attribute is rendered on its own by renderImage. The group's config sets the
// size, so its images carry no data-size or data-style.
function renderImageGroup(blocks: readonly Extract<DocumentBlock, { type: 'imageBlock' }>[], ctx: Ctx): string {
  const figures: string[] = []
  const rest: Extract<DocumentBlock, { type: 'imageBlock' }>[] = []
  for (const block of blocks) {
    const read = readOf(ctx, block.src, 'resource')
    if (read.kind !== 'bundle') {
      rest.push(block)
      continue
    }
    const file = built(ctx, block, block.src, {
      kind: 'image',
      rel: read.rel,
      suffix: read.suffix,
      config: block.attrs?.group,
    })
    const meta = imageMeta(block.attrs, ctx)
    const caption = block.caption ? renderInline(block.caption, ctx) : undefined
    const image = { alt: extractText(block.alt), title: block.title || undefined, caption }
    figures.push(bundleImageHtml(file, image, meta, ctx, false))
  }
  const restHtml = rest.map((block) => renderImage(block, ctx, [])).filter(Boolean)
  if (!figures.length) return restHtml.join('\n')
  const group = figures.length > 1 ? `<div class="image-group">\n${figures.join('\n')}\n</div>` : figures[0]
  return [group, ...restHtml].join('\n')
}

function renderImage(block: Extract<DocumentBlock, { type: 'imageBlock' }>, ctx: Ctx, dhi: Attrs): string {
  const read = readOf(ctx, block.src, 'resource')
  // a refused image shows nothing of itself, its caption neither
  if (read.kind === 'refused') return refused(ctx, block, block.src, read.reason)
  const attr = resourceConfigAttr(block.attrs)
  const bundle = read.kind === 'bundle' ? { rel: read.rel, suffix: read.suffix } : undefined
  const file =
    bundle === undefined
      ? destinationHref(ctx, block, block.src, read)
      : block.attrs?.group !== undefined
        ? built(ctx, block, block.src, { kind: 'image', ...bundle, config: block.attrs.group })
        : attr === 'native'
          ? built(ctx, block, block.src, { kind: 'native', ...bundle })
          : built(ctx, block, block.src, { kind: 'image', ...bundle, ...(attr !== undefined ? { config: attr } : {}) })
  const captionHtml = block.caption ? renderInline(block.caption, ctx) : undefined
  const alt = extractText(block.alt)
  const meta = imageMeta(block.attrs, ctx)
  if ('kind' in file) {
    const image = { alt, title: block.title || undefined, caption: captionHtml }
    return bundleImageHtml(file, image, meta, ctx)
  }
  if ('failed' in file) return notBuilt(file.failed)
  const dim = attr === 'native' && block.title ? DIMENSIONS.exec(block.title) : null
  const { size, style, ...otherData } = meta.data ?? {}
  const imageAttrs: Attrs = [['data-size', size], ['data-style', style], ['lang', meta.lang], ...dataAttrs(otherData)]
  const img: Attrs = [
    ['src', file.href],
    ['alt', alt],
    ['width', dim?.[1]],
    ['height', dim?.[2]],
    ['data-sized', dim ? true : undefined],
  ]
  const caption = captionHtml ?? (!dim && block.title ? text(block.title, ctx) : '')
  if (caption) {
    return `${startTag('figure', [['class', attr], ...imageAttrs, ...dhi])}\n${startTag('img', img)}\n<figcaption>${caption}</figcaption>\n</figure>`
  }
  return startTag('img', [...img, ['class', attr], ...imageAttrs, ...dhi])
}

/**
 * A media block's preview image (`preview=`), built like any file the content names: the poster of a video, the
 * image shown with an audio. `comment` holds what a draft shows for a preview that could not be built.
 */
function preview(attrs: ResourceAttributes | undefined, ctx: Ctx): { href?: string; comment: string } {
  if (attrs?.preview === undefined) return { comment: '' }
  const read = readOf(ctx, attrs.preview, 'resource')
  // the attributes stand for the preview: the block itself already names the media file
  const file = destinationHref(ctx, attrs, attrs.preview, read)
  return 'failed' in file ? { comment: `\n${notBuilt(file.failed)}` } : { href: file.href, comment: '' }
}

function mediaCaption(
  block: { label: readonly Inline[]; title?: string; caption?: readonly Inline[] },
  ctx: Ctx,
  autoplay = false,
): string {
  return uncounted(ctx, () => {
    const caption = block.caption
      ? renderInline(block.caption, ctx)
      : autoplay
        ? renderInline(block.label, ctx)
        : block.title
          ? text(block.title, ctx)
          : renderInline(block.label, ctx)
    return caption ? `\n<figcaption>${caption}</figcaption>` : ''
  })
}

function renderQuote(block: Extract<DocumentBlock, { type: 'quoteRegion' }>, ctx: Ctx, dhi: Attrs): string {
  let html = `${startTag('blockquote', dhi)}\n`
  let level = 0
  for (const child of block.children) {
    while (level < child.level) {
      if (level > 0) html += '\n<blockquote>\n'
      level++
    }
    while (level > child.level) {
      html += '\n</blockquote>'
      level--
    }
    if (!html.endsWith('\n')) html += '\n'
    html += renderBlock(child.block, ctx, false)
  }
  while (level > 1) {
    html += '\n</blockquote>'
    level--
  }
  if (block.attribution) {
    textBreak(ctx)
    html += `\n<footer>— ${renderInline(block.attribution, ctx)}</footer>`
  }
  return `${html}\n</blockquote>`
}

function renderListItem(item: ListItem, ctx: Ctx, kind: 'ordered' | 'unordered'): string {
  const [first, ...rest] = item.children
  const task = item.task
    ? `${startTag('input', [
        ['type', 'checkbox'],
        ['disabled', true],
        ['checked', item.task === 'done' || undefined],
      ])} `
    : ''
  const li = startTag('li', [['value', kind === 'ordered' ? item.value : undefined]])
  textBreak(ctx)
  const line = renderInline(first.children, ctx)
  const children = rest.length ? `\n${renderBlocks(rest, ctx)}` : ''
  return `${li}${task}${line}${children}</li>`
}

function renderContainer(block: Extract<DocumentBlock, { type: 'container' }>, ctx: Ctx, dhi: Attrs): string {
  const name = block.containerType?.toLowerCase() ?? 'loud'
  // rendered in output order, so typography sees the summary before the content
  const summary = name === 'exkurs' ? `<summary>${text(block.title ?? '', ctx)}</summary>` : ''
  const children =
    name === 'nocount' ? uncounted(ctx, () => renderBlocks(block.children, ctx)) : renderBlocks(block.children, ctx)
  if (!name || name === 'loud') return `${startTag('div', [['class', 'loud'], ...dhi])}\n${children}\n</div>`
  if (name === 'tldr') {
    ctx.tldr = children
    return `${startTag('div', [['class', 'tldr'], ...dhi])}\n${children}\n</div>`
  }
  if (name === 'nocount') return `${startTag('aside', [['data-nocount', true], ...dhi])}\n${children}\n</aside>`
  if (name === 'exkurs') {
    const details = startTag('details', [['class', 'exkurs'], ...dhi])
    return `${details}\n${summary}\n<aside>\n${children}\n</aside>\n</details>`
  }
  return `${startTag('div', [['class', name], ...dhi])}\n${children}\n</div>`
}

function renderBlock(block: RenderBlock, ctx: Ctx, topLevel: boolean): string {
  const dhi = blockDhi(block, ctx, topLevel)
  textBreak(ctx)
  switch (block.type) {
    case 'heading': {
      const id = block.id ?? ctx.slugs.get(block)
      ctx.headingText = ''
      const content = renderInline(block.children, ctx)
      if (id) ctx.toc.push({ id, level: block.level, text: ctx.headingText })
      ctx.headingText = undefined
      const tag = `h${block.level}`
      const held = ctx.options.heading
        ? ctx.options.heading({ level: block.level, id: id || undefined, html: content })
        : content
      return `${startTag(tag, [['id', id || undefined], ...dhi])}${held}</${tag}>`
    }
    case 'paragraph': {
      const content = renderInline(block.children, ctx)
      return content && `${startTag('p', [['id', block.id || undefined], ...dhi])}${content}</p>`
    }
    case 'horizontalRule':
      return startTag('hr', dhi)
    case 'codeBlock': {
      if (block.lang) {
        const highlighted = highlightCode(block.value, block.lang)
        if (highlighted !== null) {
          read(block.value, ctx)
          return dhi.length ? highlighted.replace('<pre ', () => `<pre${attrs(dhi)} `) : highlighted
        }
      }
      return `${startTag('pre', [...dhi, ...KEYBOARD])}<code>${shown(block.value, ctx)}\n</code></pre>`
    }
    case 'mathBlock':
      return `${startTag('pre', [...dhi, ...KEYBOARD])}<code>${shown(block.value, ctx)}\n</code></pre>`
    case 'commentBlock':
      if (!ctx.options.getBlockId) return ''
      return `${startTag('pre', [...dhi, ['class', 'hadley-editor-comment']])}${escHtml(`<!--${block.value}-->`)}</pre>`
    case 'imageBlock':
      return uncounted(ctx, () => renderImage(block, ctx, dhi))
    case 'videoBlock':
      return renderVideo(block, ctx, dhi)
    case 'audioBlock':
      return renderAudio(block, ctx, dhi)
    case 'embedBlock':
      return renderEmbed(block, ctx, dhi)
    case 'downloadBlock':
      return renderDownload(block, ctx, dhi)
    case 'list':
      return renderList(block, ctx, dhi)
    case 'table':
      return renderTable(block, ctx, dhi)
    case 'grid':
      return renderGrid(block, ctx, dhi)
    case 'quoteRegion':
      return renderQuote(block, ctx, dhi)
    case 'container':
      return renderContainer(block, ctx, dhi)
    case 'footnoteDefinition':
      return uncounted(ctx, () => renderFootnote(block, ctx, dhi))
    case 'errorBlock':
      return `${startTag('div', [['class', 'parse-error'], ...dhi])}${escHtml(block.rawContent)}</div>`
  }
}

// the media type of a video or audio file by the extension of its path
const extensionOf = (src: string) =>
  src
    .replace(/[?#].*$/, '')
    .split('.')
    .pop()!
    .toLowerCase()
const VIDEO_TYPES = new Map([
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['ogv', 'video/ogg'],
])
const AUDIO_TYPES = new Map([
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['wav', 'audio/wav'],
  ['m4a', 'audio/mp4'],
])

/** A video of the bundle or another site, with its poster (`preview`); titled `autoplay`, it plays muted in a loop. */
function renderVideo(block: Extract<RenderBlock, { type: 'videoBlock' }>, ctx: Ctx, dhi: Attrs): string {
  const src = block.src
  const file = destinationHref(ctx, block, src, readOf(ctx, src, 'resource'))
  if ('failed' in file) return notBuilt(file.failed)
  const poster = preview(block.attrs, ctx)
  const autoplay = block.title === 'autoplay'
  const video = startTag('video', [
    ...(autoplay
      ? ([
          ['autoplay', true],
          ['muted', true],
          ['loop', true],
          ['playsinline', true],
        ] as const)
      : []),
    ['controls', true],
    ['poster', poster.href],
  ])
  const source = startTag('source', [
    ['src', file.href],
    ['type', VIDEO_TYPES.get(extensionOf(src)) ?? 'video/mp4'],
  ])
  return `${startTag('figure', [...sizingAttrs(block.attrs), ...dhi])}${poster.comment}\n${video}\n  ${source}\n</video>${mediaCaption(block, ctx, autoplay)}\n</figure>`
}

/** An audio file of the bundle or another site, with its image (`preview`). */
function renderAudio(block: Extract<RenderBlock, { type: 'audioBlock' }>, ctx: Ctx, dhi: Attrs): string {
  const src = block.src
  const file = destinationHref(ctx, block, src, readOf(ctx, src, 'resource'))
  if ('failed' in file) return notBuilt(file.failed)
  const image = preview(block.attrs, ctx)
  const source = startTag('source', [
    ['src', file.href],
    ['type', AUDIO_TYPES.get(extensionOf(src)) ?? 'audio/mpeg'],
  ])
  const img = image.href ? `\n${startTag('img', [['src', image.href], ['alt', ''], ...LAZY])}` : ''
  return `${startTag('figure', [...sizingAttrs(block.attrs), ...dhi])}${image.comment}${img}\n${startTag('audio', [['controls', true]])}\n  ${source}\n</audio>${mediaCaption(block, ctx)}\n</figure>`
}

/** An embedded page of another site, which must be https; it shows no preview. */
function renderEmbed(block: Extract<RenderBlock, { type: 'embedBlock' }>, ctx: Ctx, dhi: Attrs): string {
  const read = readOf(ctx, block.target, 'embed')
  if (read.kind !== 'external') {
    const reason = read.kind === 'refused' ? read.reason : 'is not an https URL, which an embed needs'
    return refused(ctx, block, block.target, reason)
  }
  const url = read.href
  // an embed shows no preview, so a preview it names fails a published page
  const preview =
    block.attrs?.preview === undefined
      ? ''
      : `\n${refused(ctx, block.attrs, block.attrs.preview, 'cannot be the preview of an embed, which shows none')}`
  const iframe = startTag('iframe', [
    ['src', url],
    ['loading', 'lazy'],
  ])
  return `${startTag('figure', dhi)}${preview}\n${iframe}</iframe>${mediaCaption(block, ctx)}\n</figure>`
}

/** A link to download a file, in a figure when it has a caption. */
function renderDownload(block: Extract<RenderBlock, { type: 'downloadBlock' }>, ctx: Ctx, dhi: Attrs): string {
  const destination = block.href
  const read = readOf(ctx, destination, 'resource')
  const file = destinationHref(ctx, block, destination, read)
  if ('failed' in file) return notBuilt(file.failed)
  const href = file.href
  const external = read.kind === 'external'
  if (external) ctx.externalLinks.push(href)
  const label = block.label.length ? renderInline(block.label, ctx) : shown(destination, ctx)
  const anchor = startTag('a', [
    ['href', href],
    ['download', true],
    ['title', block.title || undefined],
    ['target', external ? '_blank' : undefined],
    ['rel', external ? 'noopener noreferrer' : undefined],
    ...contentAttrs(block.attrs, ctx),
  ])
  const caption = block.caption
  if (caption) {
    const captionHtml = uncounted(ctx, () => renderInline(caption, ctx))
    return `${startTag('figure', [...sizingAttrs(block.attrs), ...dhi])}\n${anchor}${label}</a>\n<figcaption>${captionHtml}</figcaption>\n</figure>`
  }
  return `${startTag('p', dhi)}${anchor}${label}</a></p>`
}

/** An ordered, unordered or definition list. */
function renderList(block: Extract<RenderBlock, { type: 'list' }>, ctx: Ctx, dhi: Attrs): string {
  if (block.kind === 'definition') {
    const items = block.items
      .map((item) => {
        const [term, ...defs] = item.children
        textBreak(ctx)
        const dt = `<dt>${renderInline(term.children, ctx)}</dt>`
        const dds = defs.map((d) => {
          textBreak(ctx)
          return `<dd>${d.type === 'paragraph' ? renderInline(d.children, ctx) : renderBlock(d, ctx, false)}</dd>`
        })
        return [dt, ...dds].join('\n')
      })
      .join('\n')
    return `${startTag('dl', dhi)}\n${items}\n</dl>`
  }
  const kind: 'ordered' | 'unordered' = block.kind
  const tag = kind === 'ordered' ? 'ol' : 'ul'
  const start = tag === 'ol' && block.start !== undefined && block.start !== 1 ? block.start : undefined
  const items = block.items.map((i) => renderListItem(i, ctx, kind)).join('\n')
  return `${startTag(tag, [['start', start], ...dhi])}\n${items}\n</${tag}>`
}

/** A table, each cell aligned as its column. */
function renderTable(block: Extract<RenderBlock, { type: 'table' }>, ctx: Ctx, dhi: Attrs): string {
  const cells = (row: typeof block.head, tag: 'th' | 'td') =>
    row.cells
      .map((cell, index) => {
        const alignment = block.alignments[index]
        const open = startTag(tag, [['data-align', alignment !== 'default' ? alignment : undefined]])
        textBreak(ctx)
        return `${open}${renderInline(cell.children, ctx)}</${tag}>`
      })
      .join('')
  const head = cells(block.head, 'th')
  const body = block.body.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('\n')
  return `${startTag('table', dhi)}\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`
}

/** A grid of cells, each placed in its column and spanning rows and columns. */
function renderGrid(block: Extract<RenderBlock, { type: 'grid' }>, ctx: Ctx, dhi: Attrs): string {
  const rows = [...(block.header ?? []), ...block.rows]
  const cells = rows.flatMap((row) =>
    row.cells.map((cell) => {
      const open = startTag('div', [
        ['class', 'grid-cell'],
        ['style', `--col:${cell.column}`],
        ['data-row-span', cell.rowSpan && cell.rowSpan !== 1 ? cell.rowSpan : undefined],
        ['data-col-span', cell.colSpan && cell.colSpan !== 1 ? cell.colSpan : undefined],
      ])
      return `${open}\n${renderBlocks(cell.children, ctx)}\n</div>`
    }),
  )
  const grid = startTag('div', [['class', 'grid'], ['style', `--cols:${block.columns}`], ...dhi])
  return `${grid}\n${cells.join('\n')}\n</div>`
}

function renderFootnote(block: Extract<Block, { type: 'footnoteDefinition' }>, ctx: Ctx, dhi: Attrs): string {
  const id = block.identifier
  const total = ctx.noteRefCounts.get(id) ?? 0
  const back = (i: number | undefined) =>
    startTag('a', [
      ['class', 'note-back'],
      ['href', `#note-${id}-ref${i ? `-${i + 1}` : ''}`],
    ])
  const backlinks =
    total > 1
      ? Array.from({ length: total }, (_, i) => `${back(i)}${escHtml(id + String.fromCharCode(97 + i))}</a>`).join('')
      : `${back(undefined)}${escHtml(id)}</a>`
  return `${startTag('aside', [['class', 'note'], ['id', `note-${id}`], ...dhi])}${backlinks}${renderInline(block.children, ctx)}</aside>`
}

export function editorBlocks(result: ParseResult, baseOffset: number, source: string): BlockToken[] {
  const tree = treeOf(result)
  if (!tree || !result.annotations) return []
  return [...tree.children, ...tree.footnotes]
    .map((block) => ({ block, range: result.annotations!.forNode(block)?.range }))
    .filter((entry): entry is typeof entry & { range: NonNullable<typeof entry.range> } => entry.range !== undefined)
    .sort((a, b) => a.range.start.offset - b.range.start.offset)
    .map(({ block, range }): BlockToken => ({
      type: block.type,
      start: baseOffset + range.start.offset,
      // Without a final line feed in the file, `end` is set as if there were one after the last block: the editor
      // always takes `end - 1` for GET and PATCH, and would otherwise lose the file's last character.
      end: baseOffset + range.end.offset + (source[range.end.offset - 1] === '\n' ? 0 : 1),
    }))
}

export function renderMarkanto(
  result: ParseResult,
  options: RenderOptions,
  baseOffset = 0,
  requests?: FileRequest[],
): Omit<CaseResult, 'metadata'> {
  const tree = treeOf(result)
  const annotations = result.status !== 'resource' ? result.annotations : undefined
  if (!tree || !annotations) {
    return {
      html: '',
      toc: [],
      annotations: [],
      externalLinks: [],
      ignoredAttributes: [],
      bodyText: '',
    }
  }
  const ctx = makeCtx(options, baseOffset, annotations, collectSlugs(tree), requests)
  for (const block of [...tree.children, ...tree.footnotes]) {
    walkBlockInline(block, (nodes) => countNoteRefsInline(nodes, ctx.noteRefCounts))
  }
  const sourceBlocks = [...tree.children, ...tree.footnotes].sort(
    (a, b) =>
      (annotations.forNode(a)?.range.start.offset ?? Number.MAX_SAFE_INTEGER) -
      (annotations.forNode(b)?.range.start.offset ?? Number.MAX_SAFE_INTEGER),
  )
  const html = renderBlocks(sourceBlocks, ctx, true)
  return {
    html,
    toc: ctx.toc,
    annotations: ctx.annotations,
    externalLinks: ctx.externalLinks,
    ignoredAttributes: ctx.ignoredAttributes,
    bodyText: ctx.bodyText.replace(/\s+/g, ' ').trim(),
    ...(ctx.tldr !== undefined ? { tldr: ctx.tldr } : {}),
  }
}

// a code block may be wider than the page: it scrolls, so the keyboard must reach it too (WCAG 2.1.1), as Shiki's has
const KEYBOARD: [string, string][] = [['tabindex', '0']]

const SLUG_STRIP = /[^\p{L}0-9]+/gu
const SLUG_TRIM = /^-+|-+$/g

function slugify(text: string): string {
  const base = text.toLowerCase().replace(SLUG_STRIP, '-').replace(SLUG_TRIM, '')
  return base === '' ? 'section' : base
}

/** Document-level + fenced-container-child headings get a deduplicated slug. */
function collectSlugs(tree: Document | RecoveryDocument): Map<object, string> {
  const out = new Map<object, string>()
  const used = new Set<string>()
  const claim = (base: string): string => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let n = 2
    while (used.has(`${base}-${n}`)) n += 1
    const slug = `${base}-${n}`
    used.add(slug)
    return slug
  }
  const visit = (block: RenderBlock, eligible: boolean): void => {
    if (block.type === 'heading') {
      if (eligible) out.set(block, claim(slugify(extractText(block.children))))
      return
    }
    if (block.type === 'quoteRegion') {
      for (const child of block.children) visit(child.block, false)
      return
    }
    if (block.type === 'container') {
      for (const child of block.children) visit(child, block.form === 'fenced')
      return
    }
    if (block.type === 'list') {
      for (const item of block.items) for (const child of item.children) visit(child, false)
    }
  }
  for (const block of tree.children) visit(block, true)
  return out
}
