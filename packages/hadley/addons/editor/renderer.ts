import { createHash } from 'node:crypto'
import type { BlockToken, ParsedDocument } from '../../case/index.ts'
import { blockIdMap, pageHeads } from './plugin.ts'

/**
 * Registers every top-level block of a page in blockIdMap, and returns getBlockId, which the renderer calls for each
 * data-hadley-id. It must finish BEFORE the page is rendered (the build calls it before render()). With `page`, its
 * head is registered too, as fixed blocks: the title and subtitle the text gives, and the front matter, which edits a
 * title or subtitle given there; pageHeads names them by the page's URL path.
 */
export function registerPageBlocks(
  blocks: BlockToken[],
  rawDoc: string,
  filePath: string,
  page?: { urlPath: string; heads: ParsedDocument['heads']; title?: string; subtitle?: string },
): (start: number) => string | undefined {
  // the file's earlier entries go: each dev reload registers it anew
  for (const [id, entry] of blockIdMap) {
    if (entry.filePath === filePath) blockIdMap.delete(id)
  }
  for (const [path, heads] of pageHeads) {
    if (heads.filePath === filePath) pageHeads.delete(path)
  }

  const fileHash = createHash('sha256').update(rawDoc).digest('hex')
  const startToId = new Map<number, string>()
  const returnsBefore = carriageReturnsBefore(rawDoc)

  for (const block of blocks) {
    if (block.start === undefined || block.end === undefined) continue
    const id = crypto.randomUUID()
    startToId.set(block.start, id)
    // the build counts in the file as it is, the editor in its text with LF (plugin.ts, readSource): with CRLF, a
    // block moves back by the carriage returns before it, and its end, which falls between \r and \n, goes past the \n
    blockIdMap.set(id, {
      filePath,
      start: block.start - returnsBefore(block.start),
      end: block.end - returnsBefore(block.end) + (rawDoc[block.end - 1] === '\r' ? 1 : 0),
      fileHashAtRender: fileHash,
      isParagraph: block.type === 'paragraph',
    })
  }

  if (page) {
    const at = (block: BlockToken, head?: 'title' | 'subtitle') => {
      const id = crypto.randomUUID()
      blockIdMap.set(id, {
        filePath,
        start: block.start - returnsBefore(block.start),
        end: block.end - returnsBefore(block.end) + (rawDoc[block.end - 1] === '\r' ? 1 : 0),
        fileHashAtRender: fileHash,
        fixed: true,
        ...(head ? { head } : {}),
      })
      return id
    }
    const { title, subtitle, frontMatter } = page.heads
    const frontMatterId = frontMatter ? at(frontMatter) : undefined
    // a title or subtitle the text does not give comes from the front matter
    const titleId = title ? at(title, 'title') : page.title !== undefined ? frontMatterId : undefined
    const subtitleId = subtitle ? at(subtitle, 'subtitle') : page.subtitle !== undefined ? frontMatterId : undefined
    pageHeads.set(page.urlPath, {
      filePath,
      ...(titleId ? { title: { id: titleId, from: title ? 'text' : 'front matter' } } : {}),
      ...(subtitleId ? { subtitle: { id: subtitleId, from: subtitle ? 'text' : 'front matter' } } : {}),
      ...(frontMatterId ? { frontMatter: { id: frontMatterId } } : {}),
    })
  }

  return (start: number) => startToId.get(start)
}

/** How many carriage returns `text` has before an index. */
function carriageReturnsBefore(text: string): (index: number) => number {
  const positions: number[] = []
  for (let i = text.indexOf('\r'); i !== -1; i = text.indexOf('\r', i + 1)) positions.push(i)
  return (index) => {
    let low = 0
    let high = positions.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (positions[middle]! < index) low = middle + 1
      else high = middle
    }
    return low
  }
}
