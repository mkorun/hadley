// What differs between two texts, line by line, for the versions (features/versions.ts): the lines both share at the
// start and the end as they are, the rest by the longest common subsequence. No library; a text of more than LINES
// lines, or a middle that differs over more than CELLS pairs of lines, is not compared (undefined), so that a
// comparison never holds the page (at most 16 MB for its table).

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
  if ((n + 1) * width > CELLS) return undefined
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
