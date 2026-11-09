// Where a file goes in at the caret (files.ts, pictures.ts): not inside an image or a link the caret stands in, which
// would nest one in the other, `![![](b.png)](a.png)` (Michael, 2026-11-09), but right after it. No DOM, so that it
// is tested on its own.

// an image or a link on one line: `![alt](target)` or `[text](target)`
const LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g

/** Where to put something in at `at` in `text`: after the image or link `at` stands inside, else `at`. */
export function spotFor(text: string, at: number): number {
  for (const match of text.matchAll(LINK)) {
    const start = match.index
    const end = start + match[0].length
    if (at > start && at < end) return end
  }
  return at
}
