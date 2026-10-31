import { createHash } from 'node:crypto'
import type { BlockToken } from '../../case/index.ts'
import { blockIdMap } from './plugin.ts'

/**
 * Registers every top-level block of a page in blockIdMap, and returns getBlockId, which the renderer calls for each
 * data-hadley-id. It must finish BEFORE the page is rendered (the build calls it before render()).
 */
export function registerPageBlocks(
  blocks: BlockToken[],
  rawDoc: string,
  filePath: string,
): (start: number) => string | undefined {
  // the file's earlier entries go: each dev reload registers it anew
  for (const [id, entry] of blockIdMap) {
    if (entry.filePath === filePath) blockIdMap.delete(id)
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
