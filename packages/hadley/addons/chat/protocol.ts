/**
 * For panel implementations, `GET /__hadley/chat/events` starts with an SSE `history` event: an array of at most 200
 * `{ event, data, at }` entries (at is epoch milliseconds), including the author's `message` entries. Historical
 * `permission` entries also have `open`, whether they can still be answered. Live events are `reply`, `suggestion`,
 * `delivered`, `permission` and `status`; their SSE id carries the event's time. `status` has `{ connected: true }`
 * or `{ connected: false }` and follows the history with the current connection state.
 */
import { randomInt } from 'node:crypto'
import { isAbsolute } from 'node:path'

export type Direction = 'clearer' | 'shorter' | 'formal' | 'casual' | 'fix' | 'custom'
type Rewrite = {
  direction: Direction
  instruction?: string
  draft: string
  block: string
} & (
  | { action: 'rewrite-block'; selection?: never }
  | { action: 'rewrite-selection'; selection: { start: number; end: number } }
)
type Action = { action?: never } | Rewrite

export type Message = {
  id: string
  text: string
  site: string
  root: string
  url: string
  file?: string
  block?: string
  lines?: string
} & Action
export interface Verdict {
  request_id: string
  allow: boolean
}
export interface Reply {
  id: string
  to?: string
  text: string
}
export interface Permission {
  request_id: string
  tool: string
  description: string
  preview: string
}
export type ChatInput = {
  page: string
  block?: string
} & ({ action?: never; text: string } | (Rewrite & { text?: string }))

export interface Suggestion extends Reply {
  to: string
}

const ACTION_KEYS = ['action', 'direction', 'instruction', 'draft', 'selection']

function action(record: Record<string, unknown>): Action {
  if (record.action === undefined) {
    for (const key of ACTION_KEYS) if (key in record) throw new Error(`${key}: requires an action`)
    return {}
  }
  if (record.action !== 'rewrite-block' && record.action !== 'rewrite-selection')
    throw new Error('action: expected rewrite-block or rewrite-selection')
  const direction = record.direction
  if (typeof direction !== 'string' || !['clearer', 'shorter', 'formal', 'casual', 'fix', 'custom'].includes(direction))
    throw new Error('direction: expected clearer, shorter, formal, casual, fix or custom')
  const instruction = direction === 'custom' ? text(record.instruction, 'instruction') : undefined
  if (instruction !== undefined && instruction.length > 500) throw new Error('instruction: at most 500 characters')
  if (direction !== 'custom' && 'instruction' in record) throw new Error('instruction: only with custom direction')
  if (typeof record.draft !== 'string' || Buffer.byteLength(record.draft) > MAX_BYTES)
    throw new Error(`draft: expected text of at most ${MAX_BYTES} bytes`)
  const common = {
    direction: direction as Direction,
    ...(instruction === undefined ? {} : { instruction }),
    draft: record.draft,
    block: text(record.block, 'block'),
  }
  if (record.action === 'rewrite-block') {
    if ('selection' in record) throw new Error('selection: only with rewrite-selection')
    return { ...common, action: record.action }
  }
  const selection = object(record.selection, ['start', 'end'], 'selection')
  const { start, end } = selection
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > common.draft.length
  )
    throw new Error('selection: expected indices 0 <= start < end <= draft.length')
  return { ...common, action: record.action, selection: { start, end } }
}

export const MAX_BYTES = 1_048_576
const ID = /^[a-z0-9]{8}$/
const REQUEST_ID = /^[a-km-z]{5}$/

/** Random in each process and across restarts, without modulo bias. */
export const newId = (): string =>
  Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)]).join('')

/** Parser diagnostics must not quote private message text or rendezvous tokens. */
export function parseJson(source: string, field: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch {
    throw new Error(`${field}: invalid JSON`)
  }
}

export function object(value: unknown, keys?: readonly string[], field = ''): Record<string, unknown> {
  const prefix = field ? `${field}: ` : ''
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${prefix}expected a JSON object`)
  const record = value as Record<string, unknown>
  if (keys)
    for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`${prefix}unknown field: ${key}`)
  return record
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_BYTES)
    throw new Error(`${field}: expected nonempty text of at most ${MAX_BYTES} bytes`)
  return value
}

function matching(value: unknown, field: string, pattern: RegExp): string {
  const result = text(value, field)
  if (!pattern.test(result)) throw new Error(`${field}: invalid format`)
  return result
}

export function origin(value: unknown): string {
  const site = text(value, 'site')
  const url = new URL(site)
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== site)
    throw new Error('site: expected an http or https origin')
  return site
}

export function chatInput(value: unknown): ChatInput {
  const record = object(value, ['text', 'page', 'block', ...ACTION_KEYS])
  const page = text(record.page, 'page')
  if (!page.startsWith('/') || page.startsWith('//') || page.includes('\\') || /[\x00-\x20]/.test(page))
    throw new Error('page: expected a local URL path')
  const rewrite = action(record)
  if (rewrite.action)
    return {
      page,
      ...rewrite,
      ...(record.text === undefined ? {} : { text: text(record.text, 'text') }),
    }
  return {
    text: text(record.text, 'text'),
    page,
    ...(record.block === undefined ? {} : { block: text(record.block, 'block') }),
  }
}

export function message(value: unknown): Message {
  const record = object(value, ['id', 'text', 'site', 'root', 'url', 'file', 'block', 'lines', ...ACTION_KEYS])
  const site = origin(record.site)
  const url = text(record.url, 'url')
  if (new URL(url).origin !== site) throw new Error('url: expected a URL in site')
  const root = text(record.root, 'root')
  if (!isAbsolute(root)) throw new Error('root: expected an absolute site directory')
  const result: Message = {
    id: matching(record.id, 'id', ID),
    text: text(record.text, 'text'),
    site,
    root,
    url,
    ...action(record),
  }
  if (record.block !== undefined) result.block = text(record.block, 'block')
  if (record.file !== undefined) {
    const file = text(record.file, 'file')
    if (file.startsWith('/') || file.includes('\\') || file.includes(':') || file.split('/').some((s) => s === '..'))
      throw new Error('file: expected a path relative to the site')
    result.file = file
  }
  if (record.lines !== undefined) {
    const lines = matching(record.lines, 'lines', /^[1-9][0-9]*-[1-9][0-9]*$/)
    const [start, end] = lines.split('-').map(Number)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end)
      throw new Error('lines: expected an ascending line range')
    result.lines = lines
  }
  return result
}

export function verdict(value: unknown): Verdict {
  const record = object(value, ['request_id', 'allow'])
  if (typeof record.allow !== 'boolean') throw new Error('allow: expected true or false')
  return { request_id: matching(record.request_id, 'request_id', REQUEST_ID), allow: record.allow }
}

export function reply(value: unknown): Reply {
  const record = object(value, ['id', 'to', 'text'])
  return {
    id: matching(record.id, 'id', ID),
    text: text(record.text, 'text'),
    ...(record.to === undefined ? {} : { to: matching(record.to, 'to', ID) }),
  }
}

export function suggestion(value: unknown): Suggestion {
  const result = reply(value)
  return { ...result, to: matching(result.to, 'to', ID) }
}

export function delivered(value: unknown): { id: string } {
  const record = object(value, ['id'])
  return { id: matching(record.id, 'id', ID) }
}

/** JSON strings delimit untrusted text even when it contains instruction-like delimiters. */
export function actionContent(data: Message): string {
  if (!data.action) return data.text
  const source =
    data.action === 'rewrite-block' ? data.draft : data.draft.slice(data.selection.start, data.selection.end)
  return [
    `Action: ${data.action}`,
    `Direction: ${JSON.stringify(data.direction === 'custom' ? data.instruction : data.direction)}`,
    `Text to rewrite (JSON string): ${JSON.stringify(source)}`,
    `Editing field context (JSON string): ${JSON.stringify(data.draft)}`,
  ].join('\n')
}

export function permission(value: unknown): Permission {
  const record = object(value, ['request_id', 'tool', 'description', 'preview'])
  // Claude Code may send an empty preview for a tool without arguments.
  if (typeof record.preview !== 'string' || Buffer.byteLength(record.preview) > MAX_BYTES)
    throw new Error('preview: expected text')
  return {
    request_id: matching(record.request_id, 'request_id', REQUEST_ID),
    tool: text(record.tool, 'tool'),
    description: text(record.description, 'description'),
    preview: record.preview,
  }
}

export const sse = (event: string, data: unknown, at?: number): string =>
  `${at === undefined ? '' : `id: ${at}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

/** Our SSE frames contain one JSON data line. Frames may arrive split at any byte, or several at once. */
export function sseParser(receive: (event: string, data: unknown) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > MAX_BYTES * 2) throw new Error('SSE frame too large')
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const lines = frame.split('\n').filter((line) => !line.startsWith(':'))
      if (lines.every((line) => !line)) continue
      if (lines[0].startsWith('id: ')) {
        if (!/^id: [0-9]+$/.test(lines[0]) || !Number.isSafeInteger(Number(lines[0].slice(4))))
          throw new Error('invalid hadley SSE time')
        lines.shift()
      }
      if (lines.length !== 2 || !lines[0].startsWith('event: ') || !lines[1].startsWith('data: '))
        throw new Error('invalid hadley SSE frame')
      receive(lines[0].slice(7), parseJson(lines[1].slice(6), 'SSE'))
    }
  }
}
