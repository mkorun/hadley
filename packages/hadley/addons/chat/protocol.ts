import { randomInt } from 'node:crypto'

export interface Message {
  id: string
  text: string
  site: string
  url: string
  file?: string
  block?: string
  lines?: string
}
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
export interface ChatInput {
  text: string
  page: string
  block?: string
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

export function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a JSON object')
  const record = value as Record<string, unknown>
  if (keys) for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`unknown field: ${key}`)
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
  const record = object(value, ['text', 'page', 'block'])
  const page = text(record.page, 'page')
  if (!page.startsWith('/') || page.startsWith('//') || page.includes('\\') || /[\x00-\x20]/.test(page))
    throw new Error('page: expected a local URL path')
  return {
    text: text(record.text, 'text'),
    page,
    ...(record.block === undefined ? {} : { block: text(record.block, 'block') }),
  }
}

export function message(value: unknown): Message {
  const record = object(value, ['id', 'text', 'site', 'url', 'file', 'block', 'lines'])
  const site = origin(record.site)
  const url = text(record.url, 'url')
  if (new URL(url).origin !== site) throw new Error('url: expected a URL in site')
  const result: Message = { id: matching(record.id, 'id', ID), text: text(record.text, 'text'), site, url }
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

export const sse = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

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
      if (lines.length !== 2 || !lines[0].startsWith('event: ') || !lines[1].startsWith('data: '))
        throw new Error('invalid hadley SSE frame')
      receive(lines[0].slice(7), parseJson(lines[1].slice(6), 'SSE'))
    }
  }
}
