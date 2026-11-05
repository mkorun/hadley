/** Public pure helpers from the browser asset, exercised by node:test without starting the panel. */
export const TEXT: Record<'en' | 'de', Record<string, string>>
export const START_COMMAND: string
export function inlineParts(source: string): { text?: string; code?: string; href?: string }[]
export function replyParts(source: string): { code: boolean; text: string }[]
interface ReplyNode {
  ownerDocument: { createElement(tag: string): ReplyNode }
  textContent: string
  href: string
  target: string
  rel: string
  append(node: ReplyNode): void
}
export function renderReply(parent: ReplyNode, source: string): void

export function selectionOf(field: {
  selectionStart: number
  selectionEnd: number
  value: string
}): { start: number; end: number } | undefined
