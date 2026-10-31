// case — post-patch integrity check.
//
// Verifies that a block-scoped edit changed nothing OUTSIDE the edited block
// at the semantic level. This is stronger than "the patched document still
// parses without diagnostics": a construct that spans the edit boundary (an
// accidentally opened fence, a list/quote that now absorbs — or stops
// absorbing — a neighbouring block) can silently reinterpret untouched
// content while producing zero diagnostics, because the result is still a
// fully valid document, just not the one the edit intended.
//
// Runs whether or not the document is fully valid: a pre-existing,
// unrelated error elsewhere doesn't stop this check, since addons/editor's
// save gate now only rejects on errors that overlap the edited block itself
// (plugin.ts) — this is what still has to catch a block silently drifting
// while ordinary diagnostics stay quiet.

import { parse as parseMarkanto010, semanticDocumentEquals } from '@markantolang/parser'
import type { Document, DocumentBlock, ErrorBlock, FootnoteDefinition } from '@markantolang/parser'
import { PARSE_OPTIONS, prepareDocument } from './prepare-document.ts'
import type { CaseOptions } from './types.ts'

/** File-absolute JS-string offsets — same convention as `BlockToken.start`/`.end`. */
export interface EditedRange {
  start: number
  end: number
}

export interface IntegrityResult {
  ok: boolean
  /** Set when `ok` is false and a specific pre-existing block was the cause — its OLD, file-absolute range. */
  mismatch?: { start: number; end: number }
}

type Node = DocumentBlock | FootnoteDefinition | ErrorBlock

interface NamedBlock {
  node: Node
  start: number
  end: number
}

/**
 * Every document-level block + footnote definition, with a file-absolute
 * range — from the valid `Document` if the source parses cleanly, or from the
 * `RecoveryDocument` (which may contain `ErrorBlock`s) otherwise, so a
 * pre-existing unrelated error elsewhere doesn't stop the comparison.
 * `undefined` if neither is available (e.g. a `resource` result) or a
 * required node has no annotation (a parser bug per docs/PARSER_CONTRACT.md)
 * — fail-closed, never guess.
 */
function parsedBlocks(rawDoc: string, options: CaseOptions): NamedBlock[] | undefined {
  const { md, baseOffset } = prepareDocument(rawDoc, options)
  const parsed = parseMarkanto010(md, PARSE_OPTIONS)
  const tree = parsed.status === 'ok' ? parsed.document : parsed.status === 'invalid' ? parsed.recovery : undefined
  const annotations = parsed.status === 'ok' || parsed.status === 'invalid' ? parsed.annotations : undefined
  if (!tree || !annotations) return undefined
  const out: NamedBlock[] = []
  for (const node of [...tree.children, ...tree.footnotes]) {
    const range = annotations.forNode(node)?.range
    if (!range) return undefined
    out.push({ node, start: baseOffset + range.start.offset, end: baseOffset + range.end.offset })
  }
  return out
}

function wrap(node: DocumentBlock | FootnoteDefinition): Document {
  return node.type === 'footnoteDefinition'
    ? { type: 'document', children: [], footnotes: [node] }
    : { type: 'document', children: [node], footnotes: [] }
}

/**
 * `ErrorBlock` is recovery-only and intentionally excluded from every
 * semantic AST union (src/ast.ts) — `semanticDocumentEquals` doesn't apply.
 * Compare its two informal fields directly instead.
 */
function blocksEqual(a: Node, b: Node): boolean {
  if (a.type === 'errorBlock' || b.type === 'errorBlock') {
    return a.type === 'errorBlock' && b.type === 'errorBlock' && a.reason === b.reason && a.rawContent === b.rawContent
  }
  const result = semanticDocumentEquals(wrap(a), wrap(b))
  return result.status === 'ok' && result.equal
}

/**
 * `oldRawDoc`/`newRawDoc` are the full file contents before/after the patch;
 * `edit` is the edited block's range in `oldRawDoc` (`BlockMapEntry.start`/
 * `.end` in `addons/editor/plugin.ts`). Call once the diagnostics gate has
 * accepted `newRawDoc` for the block actually being edited (plugin.ts:
 * no `local` error) — `newRawDoc` may still contain a pre-existing,
 * unrelated error elsewhere, which this handles via `RecoveryDocument`.
 */
export function checkOnlyEditedBlockChanged(
  oldRawDoc: string,
  newRawDoc: string,
  edit: EditedRange,
  options: CaseOptions = { bundlePath: '' },
): IntegrityResult {
  const oldBlocks = parsedBlocks(oldRawDoc, options)
  const newBlocks = parsedBlocks(newRawDoc, options)
  if (!oldBlocks || !newBlocks) return { ok: false }

  // Single block-scoped patch: only [edit.start, edit.end) changed length, so
  // everything strictly after it shifts by this delta and nothing else does.
  const delta = newRawDoc.length - oldRawDoc.length
  const oldOutside = oldBlocks.filter((b) => b.end <= edit.start || b.start >= edit.end)
  const newByStart = new Map(newBlocks.map((b) => [b.start, b] as const))

  for (const old of oldOutside) {
    const shift = old.start >= edit.end ? delta : 0
    const candidate = newByStart.get(old.start + shift)
    if (!candidate || candidate.end !== old.end + shift || !blocksEqual(old.node, candidate.node)) {
      return { ok: false, mismatch: { start: old.start, end: old.end } }
    }
  }

  // Catches a block that appeared outside the edit with no old counterpart
  // (e.g. one old block split in two) even though every matched pair above
  // compared equal — the position-keyed lookup above only checks the other
  // direction (old → new).
  const newOutsideCount = newBlocks.filter((b) => b.end <= edit.start || b.start >= edit.end + delta).length
  if (newOutsideCount !== oldOutside.length) return { ok: false }

  return { ok: true }
}
