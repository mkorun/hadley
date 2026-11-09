// What differs between two texts, for the versions (features/versions/): line by line, and within a line changed for
// another, word by word. The parts both share at the start and the end as they are, the rest by the longest common
// subsequence. No library; a text of more than LINES lines, or a middle that differs over more than CELLS pairs, is not
// compared (undefined), so that a comparison never holds the page (at most 16 MB for its table).

export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

export const LINES = 5000
export const CELLS = 4_000_000

export function lineDiff(before: string, after: string): DiffLine[] | undefined {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > LINES || b.length > LINES) return undefined
  return sequenceDiff(a, b, CELLS)
}

/** The parts of `a` and `b` (lines, or words), each the same, out (del) or in (add). */
function sequenceDiff(a: readonly string[], b: readonly string[], cells: number): DiffLine[] | undefined {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const n = endA - start
  const m = endB - start
  // lengths of the common subsequences of the tails, one row per line of a
  const width = m + 1
  if ((n + 1) * width > cells) return undefined
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const lines: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      lines.push({ kind: 'same', text: a[start + i]! })
      i += 1
      j += 1
    } else if (i < n && (j === m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
      // a line out before a line in, as a diff reads
      lines.push({ kind: 'del', text: a[start + i]! })
      i += 1
    } else {
      lines.push({ kind: 'add', text: b[start + j]! })
      j += 1
    }
  }
  for (const text of a.slice(endA)) lines.push({ kind: 'same', text })
  return lines
}

// a line changed for another is marked word by word only where the two share enough: else every word would be
const WORD_CELLS = 250_000
const SHARED = 1 / 3

/** A piece of a changed line: `changed` where it is not in the line it was changed for. */
export interface Piece {
  text: string
  changed: boolean
}

/** A line of the comparison, with its pieces where it was changed for another line. */
export type MarkedLine = DiffLine & { pieces?: Piece[] }

const words = (line: string): string[] => line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []

/** The pieces of the line out and the line in, or undefined where they share too little to be worth marking. */
export function wordDiff(before: string, after: string): { out: Piece[]; in: Piece[] } | undefined {
  const parts = sequenceDiff(words(before), words(after), WORD_CELLS)
  if (!parts) return undefined
  const counted = (kinds: string[]) => parts.filter((p) => kinds.includes(p.kind) && p.text.trim()).length
  const shared = counted(['same'])
  if (shared < SHARED * Math.max(counted(['same', 'del']), counted(['same', 'add']))) return undefined
  const pieces = (kind: 'del' | 'add'): Piece[] => {
    const out: Piece[] = []
    for (const part of parts) {
      if (part.kind !== 'same' && part.kind !== kind) continue
      // a space between two changed words is changed with them: one mark, not two
      const changed = part.kind === kind || (!part.text.trim() && out.at(-1)?.changed === true)
      const last = out.at(-1)
      if (last && last.changed === changed) last.text += part.text
      else out.push({ text: part.text, changed })
    }
    // the spaces at the ends of a mark are the text's, not the change's
    return out.flatMap((piece) => {
      if (!piece.changed) return [piece]
      const [, before = '', text = '', after = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(piece.text)!
      return [
        { text: before, changed: false },
        { text, changed: true },
        { text: after, changed: false },
      ].filter((part) => part.text)
    })
  }
  return { out: pieces('del'), in: pieces('add') }
}

/** The lines of a comparison, where a run of lines out meets a run of lines in, each pair marked word by word. */
export function marked(lines: readonly DiffLine[]): MarkedLine[] {
  const out: MarkedLine[] = lines.map((line) => ({ ...line }))
  let i = 0
  while (i < out.length) {
    if (out[i]!.kind === 'same') {
      i += 1
      continue
    }
    let end = i
    while (end < out.length && out[end]!.kind !== 'same') end += 1
    const run = out.slice(i, end)
    const dels = run.filter((line) => line.kind === 'del')
    const adds = run.filter((line) => line.kind === 'add')
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const pair = wordDiff(dels[k]!.text, adds[k]!.text)
      if (!pair) continue
      dels[k]!.pieces = pair.out
      adds[k]!.pieces = pair.in
    }
    i = end
  }
  return out
}

/** The lines of a comparison, unchanged runs folded down to `context` lines on each side of a change. */
export function folded<L extends DiffLine>(
  lines: readonly L[],
  context: number,
): (L | { kind: 'gap'; count: number })[] {
  const near = lines.map((_, i) =>
    lines.slice(Math.max(0, i - context), i + context + 1).some((line) => line.kind !== 'same'),
  )
  const out: (L | { kind: 'gap'; count: number })[] = []
  let count = 0
  lines.forEach((line, i) => {
    if (!near[i]) return void (count += 1)
    if (count > 0) out.push({ kind: 'gap', count })
    count = 0
    out.push(line)
  })
  if (count > 0) out.push({ kind: 'gap', count })
  return out
}
