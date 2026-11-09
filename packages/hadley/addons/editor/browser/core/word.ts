// The word a double click opened a block on, found in the block's Markdown (caret.ts finds it on the page): no DOM,
// so that it is tested on its own.

/**
 * The word double-clicked in `block`, where it stands in its text (0 at the start, 1 at the end), and where in the
 * word the pointer was, in characters: the field's cursor goes there.
 */
export interface Clicked {
  word: string
  at: number
  inner?: number
}

const LETTER = /[\p{L}\p{N}_]/u

/** Where the clicked word stands in `source`, or -1: a whole word, the occurrence nearest its place in the text. */
export function wordIn(source: string, { word, at }: Clicked): number {
  let best = -1
  for (let i = source.indexOf(word); i !== -1; i = source.indexOf(word, i + 1)) {
    const whole = !LETTER.test(source[i - 1] ?? '') && !LETTER.test(source[i + word.length] ?? '')
    if (!whole) continue
    if (best === -1 || Math.abs(i / source.length - at) < Math.abs(best / source.length - at)) best = i
  }
  return best
}
