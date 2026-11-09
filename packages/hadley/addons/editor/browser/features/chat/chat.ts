// The chat's state, one object instead of the 25 variables the panel once shared (Michael, 2026-11-09: no monolith),
// and what its modules do for each other: panel.ts, thread.ts and rewrite.ts each install their part of it, and
// call the others' through it. index.ts makes it and wires them.
import type { AgentName, Entry, Fields } from './events.ts'
import type { ChatTexts } from './texts.ts'

/** The open field as the editor hands it over (features/field.ts, `hadley:editor-open`). */
export interface Target {
  block: string
  frontMatter: boolean
  textarea: HTMLTextAreaElement
  wrapper: HTMLElement
  insert(start: number, end: number, text: string): boolean
  drawer?(key: 'rewrite', label: string, symbol: Element): HTMLElement
  openDrawer?(key: 'rewrite'): void
}

/** A message sent, with its replies and its timeline. */
export interface Request {
  group: HTMLElement
  children: HTMLElement
  state: HTMLElement
  timeline: HTMLElement
  started: number
  completed: boolean
  delivered: boolean
  permission: boolean
}

/** A tool's permission, asked of the author. */
export interface PermissionCard {
  id: string
  node: HTMLElement
  badge: HTMLElement
  result: HTMLElement
  open: boolean
  pending: boolean
  controls: HTMLButtonElement[]
}

/** The rewrite row of the open field (rewrite.ts). */
export interface Row {
  node: HTMLElement
  state: HTMLElement
  select: HTMLSelectElement
  custom: HTMLInputElement
  undo: HTMLButtonElement
  placeholder(): void
  showScope(): void
  pending: boolean
  controls: (HTMLSelectElement | HTMLInputElement | HTMLButtonElement)[]
  timer?: ReturnType<typeof setInterval>
  started: number
  earlyPermissions: { data: Fields; at: number }[]
}

export interface Suggestion {
  data: Fields
  node: HTMLElement
  result: HTMLElement
  controls: HTMLElement
  at: number
}

/** A rewrite the open field asked for, until its proposal is in. */
export interface LocalAction {
  target: Target
  row: Row
  draft: string
  selection: { start: number; end: number } | undefined
  request: Request
}

export const DIRECTIONS = ['clearer', 'shorter', 'formal', 'casual', 'fix', 'custom'] as const
export type Direction = (typeof DIRECTIONS)[number]
export type Status = 'pending' | 'permission' | 'done' | 'error'

/** The panel's parts (panel.ts). */
export interface Ui {
  toggle: HTMLButtonElement
  dot: HTMLElement
  panel: HTMLElement
  title: HTMLElement
  resize: HTMLButtonElement
  freshButton: HTMLButtonElement
  stopButton: HTMLButtonElement
  agentBar: HTMLElement
  detailsSwitch: HTMLInputElement
  status: HTMLElement
  offline: HTMLElement
  offlineText: HTMLElement
  starters: HTMLElement
  startResult: HTMLElement
  list: HTMLElement
  label: HTMLLabelElement
  input: HTMLTextAreaElement
  error: HTMLElement
  send: HTMLButtonElement
}

export interface Chat {
  lang: 'en' | 'de'
  t: ChatTexts
  /** a text with the connected agent's name */
  say(key: keyof ChatTexts): string
  /** the site's key to the chat's routes (addons/chat/browser-key.ts), as this browser holds it */
  key: string | null
  ui: Ui
  opened: boolean
  size: 'compact' | 'large'
  unseen: boolean
  connected: boolean
  background: AgentName | null
  available: AgentName[]
  sending: boolean
  sequence: number
  replaying: boolean
  rewritesSending: number
  detailsShown: boolean
  direction: Direction
  instruction: string
  agentName: string
  editor: Target | null
  rewriteRow: Row | null
  messages: Map<string, Request>
  replies: Map<string, { to: string | undefined; node: HTMLElement; data: Fields; at: number }>
  suggestions: Map<string, Suggestion>
  deliveries: Map<string, { data: Fields; at: number }>
  localActions: Map<string, LocalAction>
  permissions: PermissionCard[]
  answers: Map<string, string>

  // panel.ts
  setOpen(value: boolean, focus?: boolean): void
  setSize(value: 'compact' | 'large'): void
  updateSend(): void
  updateDot(): void
  setConnected(value: boolean): void
  setAgent(name: string | undefined): void
  setAvailable(names: AgentName[]): void
  save(): void
  // thread.ts
  receive(entry: Entry): void
  addMessage(data: Fields, pending: HTMLElement | undefined, at: number): void
  record(id: string, event: string, data: Fields, label: string, at: number): void
  updateState(request: Request): void
  complete(id: string, event: string, data: Fields, label: string, at: number): void
  finish(card: PermissionCard, text: string): void
  applySuggestion(id: string): void
  // rewrite.ts
  setStatus(row: Row, kind: Status, label: string): void
  setStatusLabel(row: Row, label: string): void
}

/** An element of `tag`, with its text and class where given. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

/** A button that does `action`. */
export function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

/** A POST of JSON to a chat route, with the site's key, in the panel's language, given 10 s. */
export function post(chat: Chat, path: string, body: unknown): Promise<Response> {
  return fetch(`${path}?lang=${chat.lang}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(chat.key ? { 'X-Hadley-Key': chat.key } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
}
