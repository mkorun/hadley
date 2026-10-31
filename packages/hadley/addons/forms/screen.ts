// What `hadley comments` shows of a comment (docs/comments.md): text in, text out, for a terminal of a given width.

import type { Messages } from './messages.ts'

export interface QueueEntry {
  id: string
  article_id: string
  language_version: string
  parent_comment_id: string | null
  name: string
  email: string
  submitted_at: string
  text: string
  notify: boolean
}

export interface View {
  entry: QueueEntry
  position: number // of the comment in this session, from 1
  total: number
  site: string // the host of site.origin
  articleTitle: string | undefined // from the dev build's sitelinks.json, when there is one
  note: string | null
  reply: string | null
  mailWritten: boolean
  language: string // of the dates
}

const segmenter = new Intl.Segmenter()

// a visitor's text goes to the terminal: every control character (C0, DEL, C1, which some terminals take as the start
// of an escape sequence) is shown as a replacement character instead
const printable = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '\ufffd')

/** The columns a terminal gives s: two for an emoji and a wide (East Asian) character, one for any other. */
export function displayWidth(s: string): number {
  let width = 0
  for (const { segment } of segmenter.segment(s)) width += cellsOf(segment)
  return width
}

const cellsOf = (grapheme: string): number => {
  const c = grapheme.codePointAt(0)!
  // an emoji: the pictographs and flags of U+1F000–U+1FAFF, or any character shown as an emoji (U+FE0F)
  if ((c >= 0x1f000 && c <= 0x1faff) || grapheme.includes('\ufe0f')) return 2
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  return wide ? 2 : 1
}

/** s cut to at most `width` columns, with … where it was cut. */
export function truncate(s: string, width: number): string {
  if (displayWidth(s) <= width) return s
  let out = ''
  let used = 0
  for (const { segment } of segmenter.segment(s)) {
    const cells = cellsOf(segment)
    if (used + cells > width - 1) break
    out += segment
    used += cells
  }
  return out + '…'
}

/** text in lines of at most `width` columns, broken at spaces, a word longer than a line broken where it must. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (displayWidth(candidate) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = word
      while (displayWidth(line) > width) {
        const head = truncate(line, width + 1).slice(0, -1) // the columns that fit, without the …
        lines.push(head)
        line = line.slice(head.length)
      }
    }
    lines.push(line)
  }
  return lines
}

/** The screen of one comment, `width` columns wide; with ANSI colours when `color`. */
export function screen(view: View, m: Messages, width: number, color: boolean): string {
  const w = Math.max(40, Math.min(width, 100)) - 2 // a column of margin on either side
  const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
  const bold = paint('1')
  const dim = paint('2')
  const { entry } = view

  // a line of two parts: the left one cut so that the right one fits at the line's end
  const spread = (left: string, right: string, style = (s: string) => s) => {
    const room = w - displayWidth(right) - 1
    const shown = truncate(left, room)
    return ` ${style(shown)}${' '.repeat(w - displayWidth(shown) - displayWidth(right))}${dim(right)}`
  }
  const date = new Intl.DateTimeFormat(view.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(entry.submitted_at),
  )
  const notify = entry.notify ? (view.mailWritten ? m.notifyDrafted : m.notifyWanted) : undefined
  const sender = entry.email ? `${printable(entry.name)} <${printable(entry.email)}>` : printable(entry.name)
  const when = [date, notify].filter(Boolean).join(' · ')
  const rule = dim(` ${'─'.repeat(w)}`)
  const label = (name: string, value: string | null) => {
    const shown = value ? truncate(printable(value).split('\n')[0]!, w - 10) : m.none
    return ` ${dim(name.padEnd(9))} ${shown}`
  }
  // the keys, in as many lines as the width needs
  const keyLines: string[] = []
  let plain = ''
  let styled = ''
  for (const [key, name] of m.keys.filter(([key]) => key !== 'm' || (entry.notify && !view.mailWritten))) {
    const gap = plain ? '  ' : ''
    if (plain && displayWidth(`${plain}${gap}${key} ${name}`) > w) {
      keyLines.push(` ${styled}`)
      plain = styled = ''
    }
    plain += `${plain ? '  ' : ''}${key} ${name}`
    styled += `${styled ? '  ' : ''}${bold(key)} ${name}`
  }
  keyLines.push(` ${styled}`)

  return [
    spread(`${m.title} · ${view.site}`, `${view.position} / ${view.total}`, bold),
    rule,
    spread(printable(view.articleTitle ?? entry.article_id), `(${entry.language_version})`, bold),
    ` ${truncate(sender, w)}`,
    dim(` ${truncate(when, w)}`),
    ...(entry.parent_comment_id ? [dim(` ↳ ${m.replyTo} ${entry.parent_comment_id.slice(0, 8)}…`)] : []),
    '',
    ...wrap(entry.text, w - 2).map((line) => `   ${printable(line)}`),
    '',
    label(m.note, view.note),
    label(m.reply, view.reply),
    rule,
    ...keyLines,
  ].join('\n')
}
