// The title and subtitle a document's text supplies, read from its syntax tree.

import type { Inline, ParseResult, RecoveryDocument } from '@markantolang/parser'
import { treeOf } from './destination.ts'
import { extractText } from './markanto-native-renderer.ts'

/**
 * A document's first block supplies its title when it is a level-1 heading and the front matter has none; with both,
 * the title is given twice, which is a problem, and the heading stays where it is (docs/content.md). The block
 * right after that heading supplies its subtitle when it is a paragraph of one bold span (`__Subtitle__`; another
 * Markdown renderer shows it as bold text) and the front matter has none. A block that supplies one is taken out of
 * the tree, so the page shows it once; a heading or bold line that supplies nothing stays where it is. A title or
 * subtitle is text, so a footnote reference in either is a problem: it would point to nothing.
 */
export function takeTitle(
  parsed: ParseResult,
  metadata: { title?: unknown; subtitle?: unknown },
): { parsed: ParseResult; title?: string; subtitle?: string; problems?: string[] } {
  const tree = treeOf(parsed)
  const [first, second] = tree?.children ?? []
  if (!tree || first?.type !== 'heading' || first.level !== 1) return { parsed }
  if (metadata.title)
    return {
      parsed,
      problems: [
        'the title is given twice, as title in the front matter and as the first # heading: keep one ' +
          '(a shorter name for navigations is linktext)',
      ],
    }
  const title = extractText(first.children as readonly Inline[]).trim()
  const bold = second?.type === 'paragraph' && second.children.length === 1 ? second.children[0] : undefined
  const strong = bold?.type === 'strong' && !metadata.subtitle ? bold : undefined
  const subtitle = strong ? extractText(strong.children).trim() : undefined
  const taken = subtitle === undefined ? 1 : 2
  const problems = [
    ...(holdsFootnote(first.children)
      ? ['the title (the first # heading) holds a footnote, which a title cannot show']
      : []),
    ...(strong && holdsFootnote(strong.children)
      ? ['the subtitle (the bold line under the title) holds a footnote, which a subtitle cannot show']
      : []),
  ]
  const supplied = {
    title,
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(problems.length ? { problems } : {}),
  }
  if (parsed.status === 'ok') {
    const document = { ...parsed.document, children: parsed.document.children.slice(taken) }
    return { parsed: { ...parsed, document }, ...supplied }
  }
  if (parsed.status === 'invalid' && parsed.recovery) {
    const recovery: RecoveryDocument = { ...parsed.recovery, children: parsed.recovery.children.slice(taken) }
    return { parsed: { ...parsed, recovery }, ...supplied }
  }
  return { parsed }
}

/** Whether inline content holds a footnote reference, at any depth. */
function holdsFootnote(inlines: readonly unknown[]): boolean {
  return inlines.some((node) => {
    const inline = node as { type?: string; children?: unknown }
    return inline.type === 'footnoteReference' || (Array.isArray(inline.children) && holdsFootnote(inline.children))
  })
}
