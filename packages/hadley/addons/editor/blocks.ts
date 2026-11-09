/**
 * The blocks of the pages the build registered (renderer.ts), which the editor's routes act on: each block's file and
 * offsets by its id, and each page's head (its title, subtitle and front matter) by its URL path.
 */

export interface BlockMapEntry {
  filePath: string
  start: number // JS string index in the whole file (front matter and H1 included)
  end: number // exclusive: the position after the closing \n
  fileHashAtRender: string
  isParagraph?: boolean
  // a page's title, subtitle or front matter: edited as a block, never moved, merged or deleted
  fixed?: boolean
  // a title or subtitle the text gives is edited as its text alone: `# ` and `__…__` stay the editor's (headText)
  head?: 'title' | 'subtitle'
}

/** The text of a title or subtitle line without its syntax, as the editor shows it. */
export const headText = (head: 'title' | 'subtitle', line: string): string =>
  head === 'title' ? line.replace(/^#[ \t]+/, '') : line.replace(/^__([\s\S]*)__$/, '$1')

/** A title or subtitle, edited as its text, as its line again: one line, never empty. */
export const headLine = (head: 'title' | 'subtitle', text: string): string | undefined => {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return head === 'title' ? `# ${line}` : `__${line}__`
}

// The server's map: blockId → source file and offsets. Every build fills it anew (registerPageBlocks drops a file's
// old entries).
export const blockIdMap = new Map<string, BlockMapEntry>()

/** A page's head, by its URL path: the block that edits its title and its subtitle. */
export interface PageHeads {
  filePath: string
  // from: whether the text gives it (its line of Markdown) or the front matter
  title?: { id: string; from: 'text' | 'front matter' }
  subtitle?: { id: string; from: 'text' | 'front matter' }
  // the block that edits the page's front matter, where it has one
  frontMatter?: { id: string }
}
export const pageHeads = new Map<string, PageHeads>()
