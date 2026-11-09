// Where the field's cursor goes when a block is opened by a double click: on the word clicked, as the page selected
// it, found in the block's Markdown, which may differ from the text shown (marks, links, escapes). Of several
// occurrences, the one at about the same place in the text (word.ts).
import type { Clicked } from './word.ts'

/** The word the page selected on a double click in `element`, if it is one inside it. */
export function clickedWord(element: Element): Clicked | undefined {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const word = selection.toString().trim()
  if (!word || !element.contains(range.startContainer)) return undefined
  const before = document.createRange()
  before.selectNodeContents(element)
  before.setEnd(range.startContainer, range.startOffset)
  const length = element.textContent?.length ?? 0
  // the page's selection would stay over the open field
  selection.removeAllRanges()
  return { word, at: length > 0 ? before.toString().length / length : 0 }
}
