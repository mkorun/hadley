// The front matter as a table.
//
// The front matter is Lima: its lines are striped, its keys stand out and its comments step back, each where Lima's
// outline() finds it (@limaformat/lima, served by the dev server), so that `Autor:in: x` has the key `Autor:in` and a
// line of a `|` scalar has none. A layer under the textarea draws it; the textarea, its text transparent, keeps the
// caret, the selection, undo and everything else a textarea does. A line Lima refuses is marked as it is typed, its
// message below.
import { el } from '../core/dom.ts'
import { T } from '../core/texts.ts'

interface Point {
  line: number
  column: number
}
interface Span {
  start: Point
  end: Point
}
/** What the editor reads of Lima's outline(). */
type Outline = (text: string) => {
  keys: { span: Span }[]
  comments: Span[]
  diagnostics: { line: number; message: string }[]
}

// a name, not a literal: the module is the dev server's, not one TypeScript resolves
const LIMA_MODULE = '/__hadley/lima/index.js'
let limaOutline: Outline | null = null
let limaLoading: Promise<void> | null = null
let limaFailed = false

function loadLima() {
  limaLoading ??= import(LIMA_MODULE)
    .then((lima: { outline: Outline }) => {
      limaOutline = lima.outline
    })
    .catch(() => {
      // without Lima the lines are still striped, and the table says that it checks nothing (review 2026-11-05)
      limaFailed = true
    })
  return limaLoading
}

/** The table around `textarea`, which it holds. */
export function limaTable(textarea: HTMLTextAreaElement): HTMLElement {
  const table = el('div', 'hadley-fm')
  const layer = el('div', 'hadley-fm-layer')
  layer.setAttribute('aria-hidden', 'true')
  const status = el('p', 'hadley-fm-status')
  status.setAttribute('role', 'status')
  status.hidden = true
  const box = el('div', 'hadley-fm-box')
  textarea.setAttribute('spellcheck', 'false')
  box.append(layer, textarea)
  table.append(box, status)
  // keys in bold only where the font gives bold letters the same width, else the caret would stand beside its letter
  const probe = (weight: string) => {
    const span = el('span')
    span.textContent = 'abcdefghijklmnopqrstuvwxyz_:ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    span.style.fontWeight = weight
    layer.append(span)
    const width = span.getBoundingClientRect().width
    span.remove()
    return width
  }
  requestAnimationFrame(() => {
    if (Math.abs(probe('700') - probe('400')) < 0.5) table.dataset['boldKeys'] = ''
  })

  const draw = () => {
    const text = textarea.value
    const marks = new Map<number, { from: number; to: number; kind: string }[]>() // line → marks, columns from 0
    const mark = (span: Span, kind: string) => {
      const { line, column } = span.start
      // a span ends on its own line: keys and comments never run over one
      const to = span.end.line === line ? span.end.column - 1 : Infinity
      if (!marks.has(line)) marks.set(line, [])
      marks.get(line)!.push({ from: column - 1, to, kind })
    }
    let errors: { line: number; message: string }[] = []
    if (limaOutline) {
      const result = limaOutline(text)
      for (const key of result.keys) mark(key.span, 'key')
      for (const comment of result.comments) mark(comment, 'comment')
      errors = result.diagnostics
    }
    const errorLines = new Set(errors.map((d) => d.line))
    const rows = text.split('\n').map((line, index) => {
      const row = el('div', 'hadley-fm-line')
      if (errorLines.has(index + 1)) row.classList.add('is-error')
      let at = 0
      for (const { from, to, kind } of (marks.get(index + 1) ?? []).sort((a, b) => a.from - b.from)) {
        if (from < at) continue
        if (from > at) row.append(line.slice(at, from))
        const part = el('span', `hadley-fm-${kind}`)
        part.textContent = line.slice(from, Math.min(to, line.length))
        row.append(part)
        at = Math.min(to, line.length)
      }
      if (at < line.length) row.append(line.slice(at))
      return row
    })
    layer.replaceChildren(...rows)
    layer.scrollTop = textarea.scrollTop
    // Lima's message names the line itself
    status.textContent = errors[0]?.message ?? (limaFailed ? T.limaUnavailable : '')
    status.hidden = !status.textContent
  }
  textarea.addEventListener('input', draw)
  textarea.addEventListener('scroll', () => {
    layer.scrollTop = textarea.scrollTop
  })
  draw()
  void loadLima().then(draw)
  return table
}
