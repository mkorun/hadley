// Where the field's cursor goes when a block is opened by a double click: where the pointer was, in the word the page
// selected, found in the block's Markdown, which may differ from the text shown (marks, links, escapes). Of several
// occurrences, the one at about the same place in the text (word.ts). A cursor, not a selection: the first key would
// type over a selected word (Michael, 2026-11-09).
import type { Clicked } from './word.ts'

/** The character under the pointer: Firefox's caretPositionFromPoint, else Chromium's and WebKit's older name. */
function pointed(x: number, y: number): { node: Node; offset: number } | undefined {
  const doc = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?(x: number, y: number): Range | null
  }
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}

/** The word the page selected on a double click at `event` in `element`, if it is one inside it. */
export function clickedWord(element: Element, event?: MouseEvent): Clicked | undefined {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const word = selection.toString().trim()
  if (!word || !element.contains(range.startContainer)) return undefined
  const before = document.createRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  const length = element.textContent?.length ?? 0
  // where in the word the pointer was: in the word's own text node, else its start
  const point = event && pointed(event.clientX, event.clientY)
  const lead = selection.toString().length - selection.toString().trimStart().length
  const inner =
    point && point.node === range.startContainer
      ? Math.min(Math.max(point.offset - range.startOffset - lead, 0), word.length)
      : 0
  // the page's selection would stay over the open field
  selection.removeAllRanges()
  return { word, at: length > 0 ? before.toString().length / length : 0, inner }
}
