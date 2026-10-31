// case — Hadley document parser
// Frontmatter extraction (LIMA) + Markanto parsing in one pass.

import { parse as parseMarkanto, type ParseResult } from '@markantolang/parser'
import { editorBlocks, renderMarkanto } from './markanto-native-renderer.ts'
import { completeMetadata, PARSE_OPTIONS, prepareDocument } from './prepare-document.ts'
import { takeTitle } from './title.ts'
import type { BlockToken, Built, CaseOptions, CaseResult, FileRequest, ParseErrorInfo, RenderOptions } from './types.ts'

export { typographyText } from './typography.ts'
export { checkOnlyEditedBlockChanged } from './integrity.ts'
export type { EditedRange, IntegrityResult } from './integrity.ts'
export type { AiLabel, Built, FileRequest, Heading, Picture } from './types.ts'
export { attrs, escAttr, escHtml, jsonScript, pictureHtml, startTag } from './html.ts'
export { readDestination } from './destination.ts'
export type { Destination, Use } from './destination.ts'
export type { AttrValue, Attrs } from './html.ts'

/** A document parsed once: its metadata, its Markanto tree and the blocks the editor addresses. */
export interface ParsedDocument {
  metadata: Record<string, any>
  parsed: ParseResult
  baseOffset: number
  blocks: BlockToken[]
  parseErrors?: ParseErrorInfo[]
}

/** Reads the front matter and parses the content with the Markanto reference parser; render() turns it into HTML. */
export function parseDocument(rawDoc: string, options: CaseOptions): ParsedDocument {
  const { md, metadata, baseOffset, frontMatterErrors } = prepareDocument(rawDoc, options)
  const { parsed, title, subtitle, problems } = takeTitle(parseMarkanto(md, PARSE_OPTIONS), metadata)
  if (title !== undefined) metadata.title = title
  if (subtitle !== undefined) metadata.subtitle = subtitle
  completeMetadata(metadata, options)
  // Every reason the document is not what its source says is a parse error: a front matter LIMA rejected (it is
  // then empty), an error diagnostic of an invalid document (error recovery rendered the rest), and a parser budget
  // exhausted (there is no tree at all). Each diagnostic's `range` is shifted by baseOffset into the same
  // file-absolute coordinate space as BlockToken, so a caller can test which block an error falls in.
  const diagnostic = (d: ParseResult['diagnostics'][number]): ParseErrorInfo => ({
    message: d.message ?? d.category,
    ...(d.range ? { start: baseOffset + d.range.start.offset, end: baseOffset + d.range.end.offset } : {}),
  })
  const parseErrors: ParseErrorInfo[] = [
    ...(frontMatterErrors ?? []),
    ...(problems ?? []).map((message) => ({ message })),
    ...(parsed.status === 'invalid' ? parsed.diagnostics.filter((d) => d.severity === 'error').map(diagnostic) : []),
    ...(parsed.status === 'resource'
      ? [
          {
            message: `the Markanto parser stopped at a resource limit (${parsed.diagnostics.map((d) => d.message ?? d.category).join('; ')}), so nothing of the document is shown`,
          },
        ]
      : []),
  ]
  return {
    metadata,
    parsed,
    baseOffset,
    blocks: editorBlocks(parsed, baseOffset, md),
    ...(parseErrors.length ? { parseErrors } : {}),
  }
}

export function render(doc: ParsedDocument, options: RenderOptions): Omit<CaseResult, 'metadata' | 'parseErrors'> {
  return renderMarkanto(doc.parsed, options, doc.baseOffset)
}

/**
 * Every file the content names, in the order the page shows them: render() with the same options, recorded instead
 * of written. Build these, then render() with what was built.
 */
export function fileRequests(doc: ParsedDocument, options: Omit<RenderOptions, 'files'>): FileRequest[] {
  const requests: FileRequest[] = []
  renderMarkanto(doc.parsed, options, doc.baseOffset, requests)
  return requests
}

/**
 * parseDocument and render in one step, for a caller that needs both at once. Without a site to check them against,
 * the site paths it names are written as they resolve; code in a language needs Shiki loaded (prepareHighlighter).
 */
export function extract(rawDoc: string, options: CaseOptions): CaseResult {
  const doc = parseDocument(rawDoc, options)
  options.onBlocks?.(doc.blocks)
  const placed = { ...options, bundlePath: options.bundlePath ?? '', urlPath: options.urlPath ?? '/' }
  const files = new Map<object, Built>(options.files)
  for (const ref of fileRequests(doc, placed)) {
    if (ref.kind === 'path' && !files.has(ref.node)) files.set(ref.node, { kind: 'file', href: ref.href })
  }
  const result = render(doc, { ...placed, files })
  return { ...result, metadata: doc.metadata, ...(doc.parseErrors ? { parseErrors: doc.parseErrors } : {}) }
}

export {
  initHighlighter,
  prepareHighlighter,
  getHighlighterCSS,
  loadHighlightingCache,
  getHighlightingCache,
  isHighlightingCacheModified,
  hasCode,
} from './highlighter.ts'
export type { HighlightCacheFile, Themes } from './highlighter.ts'
export type {
  BlockToken,
  TocEntry,
  Annotation,
  RenderOptions,
  ParseErrorInfo,
  CaseOptions,
  CaseResult,
} from './types.ts'
