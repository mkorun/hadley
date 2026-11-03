import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { blockIdMap, readBody } from '../editor/plugin.ts'
import { lf, slashed } from '../../lib/platform.ts'
import { certificateFingerprint, createRendezvous, rendezvousDirectory } from './rendezvous.ts'
import {
  chatInput,
  message,
  newId,
  origin,
  parseJson,
  permission,
  reply,
  sse,
  verdict,
  type Message,
  type Reply,
  type Permission,
} from './protocol.ts'

type Entry =
  | { event: 'message'; data: Message }
  | { event: 'reply'; data: Reply }
  | { event: 'permission'; data: Permission }
  | { event: 'status'; data: { connected: boolean } }

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

function emit(res: ServerResponse, event: string, data: unknown): void {
  res.write(sse(event, data))
}

function stream(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')
}

export function chatPlugin(options: {
  root: string
  site: string
  port: number
  origin: string
  certificate?: Buffer
}) {
  const site = origin(options.site)
  const root = resolve(options.root)
  // Check the private directory before the server starts; publish only once it is listening.
  const dir = rendezvousDirectory()
  let rendezvous: ReturnType<typeof createRendezvous> | undefined
  let channel: ServerResponse | undefined
  const browsers = new Set<ServerResponse>()
  const history: Entry[] = []
  const open = new Set<string>()
  const ids = new Map<string, 'message' | 'reply'>()

  function remember(entry: Entry): void {
    history.push(entry)
    if (history.length > 200) history.shift()
  }

  function broadcast(entry: Entry): void {
    remember(entry)
    for (const browser of browsers) emit(browser, entry.event, entry.data)
  }

  function disconnect(): void {
    channel = undefined
    open.clear()
    broadcast({ event: 'status', data: { connected: false } })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path === '/__hadley/channel/events' && req.method === 'GET') {
      const previous = channel
      stream(res)
      channel = res
      if (previous) open.clear()
      previous?.end()
      res.once('close', () => {
        if (channel === res) disconnect()
      })
      broadcast({ event: 'status', data: { connected: true } })
      return
    }
    if (path === '/__hadley/chat/events' && req.method === 'GET') {
      stream(res)
      emit(
        res,
        'history',
        history.map((entry) =>
          entry.event === 'permission' ? { ...entry, open: open.has(entry.data.request_id) } : entry,
        ),
      )
      emit(res, 'status', { connected: channel !== undefined })
      browsers.add(res)
      res.once('close', () => browsers.delete(res))
      return
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'chat: method not allowed' })
    const body = parseJson(await readBody(req, 'en'), 'chat body')
    if (path === '/__hadley/chat') {
      const input = chatInput(body)
      if (!channel) return send(res, 503, { error: 'chat: no channel connected' })
      const attachment: { file?: string; block?: string; lines?: string } = {}
      if (input.block !== undefined) {
        const entry = blockIdMap.get(input.block)
        if (!entry) return send(res, 404, { error: 'chat: unknown block' })
        const file = slashed(relative(root, entry.filePath))
        if (isAbsolute(file) || file.split('/').includes('..')) throw new Error('chat: block is outside the site')
        const raw = await readFile(entry.filePath, 'utf8')
        if (createHash('sha256').update(raw).digest('hex') !== entry.fileHashAtRender)
          return send(res, 409, { error: 'chat: block source changed since the build; reload first' })
        const source = lf(raw)
        const first = source.slice(0, entry.start).split('\n').length
        const last = source.slice(0, Math.max(entry.start, entry.end - 1)).split('\n').length
        Object.assign(attachment, { file, block: input.block, lines: `${first}-${last}` })
      }
      if (!channel) return send(res, 503, { error: 'chat: no channel connected' })
      let id: string
      do id = newId()
      while (ids.has(id))
      const data = message({ id, text: input.text, site, url: new URL(input.page, site).href, ...attachment })
      ids.set(id, 'message')
      remember({ event: 'message', data })
      emit(channel, 'message', data)
      send(res, 200, { id })
      return
    }
    if (path === '/__hadley/chat/verdict') {
      const data = verdict(body)
      if (!open.has(data.request_id)) return send(res, 409, { error: 'chat: request_id is not an open request' })
      if (!channel) return send(res, 503, { error: 'chat: no channel connected' })
      open.delete(data.request_id)
      emit(channel, 'verdict', data)
      send(res, 200, {})
      return
    }
    if (path === '/__hadley/channel') {
      if (!channel) return send(res, 409, { error: 'chat: connect the channel event stream first' })
      // Each shape has its own required fields; no field or unknown message kind is guessed.
      if (typeof body === 'object' && body !== null && 'request_id' in body) {
        const data = permission(body)
        if (open.has(data.request_id)) return send(res, 409, { error: 'chat: request_id is already open' })
        if (open.size >= 200) return send(res, 409, { error: 'chat: too many open permission requests' })
        open.add(data.request_id)
        broadcast({ event: 'permission', data })
      } else {
        const data = reply(body)
        if (ids.has(data.id)) return send(res, 409, { error: 'chat: duplicate reply id' })
        if (data.to !== undefined && ids.get(data.to) !== 'message')
          return send(res, 409, { error: 'chat: reply names an unknown message' })
        ids.set(data.id, 'reply')
        broadcast({ event: 'reply', data })
      }
      send(res, 200, {})
      return
    }
    send(res, 404, { error: 'chat: unknown endpoint' })
  }

  const plugin: Plugin = {
    name: 'hadley-chat',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (
          path !== '/__hadley/chat' &&
          !path.startsWith('/__hadley/chat/') &&
          path !== '/__hadley/channel' &&
          !path.startsWith('/__hadley/channel/')
        )
          return next()
        handle(req, res).catch((error: unknown) => {
          if (!res.headersSent) send(res, 400, { error: `chat: ${error instanceof Error ? error.message : error}` })
          else res.destroy()
        })
      })
    },
  }
  return {
    plugin,
    get token(): string | undefined {
      return rendezvous?.record.token
    },
    start() {
      rendezvous = createRendezvous(
        {
          port: options.port,
          site,
          root,
          origin: options.origin,
          ...(options.certificate ? { fingerprint: certificateFingerprint(options.certificate) } : {}),
        },
        dir,
      )
    },
    close() {
      channel?.end()
      for (const browser of browsers) browser.end()
      browsers.clear()
      rendezvous?.close()
    },
  }
}
