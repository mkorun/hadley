// An agent's reply as the panel shows it, and what an action rewrites: no DOM of their own, so that they are tested on
// their own. A deliberately small reply grammar: paragraphs, code fences, inline code and absolute HTTP(S) links; HTML
// and any other link stay literal text, and reach only textContent.

export type Part = { text: string; href?: string; code?: never } | { code: string; text?: never; href?: never }

/** A paragraph's parts: text, inline code, and links whose checked destination is an absolute HTTP(S) URL. */
export function inlineParts(source: string): Part[] {
  const parts: Part[] = []
  const tokens = /`([^`\n]+)`|\[([^[\]\n]+)\]\(([^()[\]\s]+)\)/g
  let start = 0
  for (const match of source.matchAll(tokens)) {
    if (match.index > start) parts.push({ text: source.slice(start, match.index) })
    if (match[1] !== undefined) parts.push({ code: match[1] })
    else {
      let href: string | undefined
      try {
        const url = new URL(match[3]!)
        if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href
      } catch {
        // A malformed or relative destination stays visible as text.
      }
      parts.push(href ? { text: match[2]!, href } : { text: match[0] })
    }
    start = match.index + match[0].length
  }
  if (start < source.length) parts.push({ text: source.slice(start) })
  return parts
}

/** A reply's blocks: paragraphs between blank lines, and fenced code as it is. */
export function replyParts(source: string): { code: boolean; text: string }[] {
  const blocks: { code: boolean; text: string }[] = []
  let lines: string[] = []
  let fenced = false
  const flush = () => {
    if (lines.length) blocks.push({ code: fenced, text: lines.join('\n') })
    lines = []
  }
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if ((!fenced && /^```[^`]*$/.test(line)) || (fenced && /^```\s*$/.test(line))) {
      flush()
      fenced = !fenced
    } else if (!fenced && !line.trim()) flush()
    else lines.push(line)
  }
  flush()
  return blocks
}

// what renderReply needs of an element, so that it is checked without a DOM, and tested with one made up
interface Made<N> {
  textContent: string | null
  append(...nodes: N[]): void
}
interface Link {
  href: string
  target: string
  rel: string
}

/** Reply strings only reach textContent; only inlineParts' checked absolute HTTP(S) URL can reach href. */
export function renderReply<N extends Made<N>>(
  parent: { ownerDocument: { createElement(tag: string): N }; append(...nodes: N[]): void },
  source: string,
): void {
  const doc = parent.ownerDocument
  for (const block of replyParts(source)) {
    const node = doc.createElement(block.code ? 'pre' : 'p')
    if (block.code) {
      const code = doc.createElement('code')
      code.textContent = block.text
      node.append(code)
    } else {
      for (const part of inlineParts(block.text)) {
        if (part.code !== undefined) {
          const code = doc.createElement('code')
          code.textContent = part.code
          node.append(code)
        } else if (part.href) {
          const link = doc.createElement('a') as N & Link
          link.textContent = part.text
          link.href = part.href
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          node.append(link)
        } else {
          const span = doc.createElement('span')
          span.textContent = part.text
          node.append(span)
        }
      }
    }
    parent.append(node)
  }
}

/**
 * What an action rewrites in the editing field: its selection, or the whole block (undefined) where nothing or all of
 * it is selected, as after Ctrl+Z, which selects what it restored.
 */
export function selectionOf(field: {
  selectionStart: number
  selectionEnd: number
  value: string
}): { start: number; end: number } | undefined {
  const { selectionStart: start, selectionEnd: end, value } = field
  return start === end || (start === 0 && end === value.length) ? undefined : { start, end }
}
