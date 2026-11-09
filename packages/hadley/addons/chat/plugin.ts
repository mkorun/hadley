import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { blockIdMap, readBody } from '../editor/plugin.ts'
import { lf, slashed } from '../../lib/platform.ts'
import { certificateFingerprint, createRendezvous, rendezvousDirectory } from './rendezvous.ts'
import { browserKey, isKey } from './browser-key.ts'
import { AGENTS, isAgentName, runAgent, type AgentName, type Notice, type Running } from './agents.ts'

export { agentPrograms } from './agents.ts'
import {
  agent,
  chatInput,
  delivered,
  suggestion,
  message,
  newId,
  origin,
  object,
  parseJson,
  permission,
  reply,
  sse,
  verdict,
  type Message,
  type Reply,
  type Permission,
} from './protocol.ts'

// the page of the link with the key (browser-key.ts): the key is kept by the panel's origin, chat.js reads it there
// (review 2026-11-05): it keeps a key only once the server took it, so that no other page can replace the right one
// with a wrong one, and it runs in no frame
const UNLOCK_PAGE = `<!doctype html><meta charset="utf-8"><title>hadley</title><script>
const key = location.hash.slice(1)
const go = () => location.replace('/')
if (window.top !== window || !/^[0-9a-f]{64}$/.test(key)) go()
else
  fetch('/__hadley/chat/key', { cache: 'no-store', headers: { 'X-Hadley-Key': key } })
    .then((response) => {
      if (response.status === 204) localStorage.setItem('hadley-chat-key', key)
    })
    .catch(() => {})
    .finally(go)
</script>`

type Entry = (
  | { event: 'message'; data: Message }
  | { event: 'reply' | 'suggestion'; data: Reply }
  | { event: 'delivered'; data: { id: string } }
  | { event: 'permission'; data: Permission }
  | { event: 'status'; data: Status }
  | { event: 'notice'; data: { kind: Notice; agent: string; code?: string } }
) & { at?: number }

// whether an agent is connected, by its name; the one the dev server runs itself, and those it could start
interface Status {
  connected: boolean
  agent?: string
  background?: AgentName
  available: AgentName[]
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

function emit(res: ServerResponse, event: string, data: unknown, at?: number): void {
  res.write(sse(event, data, at))
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
  // the agents the dev server can start itself, by their programs (agents.ts, agentPrograms)
  agents?: Partial<Record<AgentName, string>>
}) {
  const programs = options.agents ?? {}
  const available = (Object.keys(AGENTS) as AgentName[]).filter((name) => programs[name] !== undefined)
  const site = origin(options.site)
  const root = resolve(options.root)
  // Check the private directory before the server starts; publish only once it is listening.
  const dir = rendezvousDirectory()
  // the browser's key to the chat's own routes (browser-key.ts)
  const browser = browserKey(dir, root)
  let rendezvous: ReturnType<typeof createRendezvous> | undefined
  let channel: ServerResponse | undefined
  // the name the channel's client gave itself (MCP initialize), shown in the panel
  let agentName: string | undefined
  // the agent the dev server started itself (agents.ts): a dev server has one agent, this or a channel
  let background: Running | undefined
  const browsers = new Set<ServerResponse>()
  const history: Entry[] = []
  const open = new Set<string>()
  const ids = new Map<string, 'message' | 'action' | 'reply'>()
  const answered = new Set<string>()
  const handed = new Set<string>()

  function remember(entry: Entry): void {
    entry.at = Date.now()
    history.push(entry)
    if (history.length > 200) history.shift()
  }

  function broadcast(entry: Entry): void {
    remember(entry)
    for (const browser of browsers) emit(browser, entry.event, entry.data, entry.at)
  }

  function status(): Status {
    if (background) return { connected: true, agent: AGENTS[background.name], background: background.name, available }
    return { connected: channel !== undefined, ...(channel && agentName ? { agent: agentName } : {}), available }
  }

  function disconnect(): void {
    channel = undefined
    agentName = undefined
    open.clear()
    broadcast({ event: 'status', data: status() })
  }

  /** Starts an agent in the background, in place of one that runs. */
  async function startAgent(name: AgentName, fresh: boolean): Promise<void> {
    await background?.stop()
    const running = runAgent(
      { name, program: programs[name]!, root, fresh },
      {
        delivered(id) {
          handed.add(id)
          broadcast({ event: 'delivered', data: { id } })
        },
        answer(to, text, action) {
          let id: string
          do id = newId()
          while (ids.has(id))
          ids.set(id, 'reply')
          // an empty answer is said as one, never as a proposal that would empty the block
          if (action && text.trim()) {
            answered.add(to)
            broadcast({ event: 'suggestion', data: { id, to, text } })
          } else broadcast({ event: 'reply', data: { id, ...(action ? {} : { to }), text: text.trim() ? text : '—' } })
        },
        permission(request) {
          open.add(request.request_id)
          broadcast({ event: 'permission', data: request })
        },
        notice(kind, code) {
          broadcast({ event: 'notice', data: { kind, agent: AGENTS[name], ...(code ? { code } : {}) } })
        },
        ended() {
          if (background !== running) return
          background = undefined
          open.clear()
          broadcast({ event: 'status', data: status() })
        },
      },
    )
    background = running
    broadcast({ event: 'status', data: status() })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && (path === '/__hadley/chat.js' || path === '/__hadley/chat.css')) {
      const name = path.endsWith('.js') ? 'chat.js' : 'chat.css'
      const source = await readFile(new URL(`./assets/${name}`, import.meta.url), 'utf8')
      res.writeHead(200, {
        'Content-Type': name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(source)
      return
    }
    // The link hadley dev prints: this page keeps the key from its fragment, which no request carries, in this
    // origin's storage, and goes on to the site's home, always the same place. It needs no key, and holds none.
    if (path === '/__hadley/chat/unlock' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      })
      res.end(UNLOCK_PAGE)
      return
    }
    // the browser's routes, the chat's events, messages and verdicts, answer the browser that holds the key: in a
    // header, or, for the event stream, which can send none, in its address
    const presented =
      req.headers['x-hadley-key'] ??
      (path === '/__hadley/chat/events'
        ? (new URL(req.url ?? '/', 'http://localhost').searchParams.get('key') ?? undefined)
        : undefined)
    if (
      (path === '/__hadley/chat' || path.startsWith('/__hadley/chat/')) &&
      !isKey(typeof presented === 'string' ? presented : undefined, browser.key)
    )
      return send(res, 401, { error: 'chat: open the link with the key that hadley dev printed', locked: true })
    // the panel asks first whether this browser holds the key, and says how to get it if not
    if (path === '/__hadley/chat/key' && req.method === 'GET') {
      res.writeHead(204, { 'Cache-Control': 'no-store' })
      res.end()
      return
    }
    if (path === '/__hadley/channel/events' && req.method === 'GET') {
      if (background) return send(res, 409, { error: 'chat: this dev server already has an agent' })
      const previous = channel
      stream(res)
      channel = res
      agentName = undefined
      if (previous) open.clear()
      previous?.end()
      res.once('close', () => {
        if (channel === res) disconnect()
      })
      broadcast({ event: 'status', data: status() })
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
      emit(res, 'status', status(), Date.now())
      browsers.add(res)
      res.once('close', () => browsers.delete(res))
      return
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'chat: method not allowed' })
    const body = parseJson(await readBody(req, 'en'), 'chat body')
    if (path === '/__hadley/chat') {
      const input = chatInput(body)
      if (!channel && !background) return send(res, 503, { error: 'chat: no agent connected' })
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
      const agent = background ?? channel
      if (!agent) return send(res, 503, { error: 'chat: no agent connected' })
      let id: string
      do id = newId()
      while (ids.has(id))
      const { page, ...fields } = input
      const data = message({
        ...fields,
        id,
        text: input.text ?? input.action,
        site,
        root,
        url: new URL(page, site).href,
        ...attachment,
      })
      ids.set(id, input.action ? 'action' : 'message')
      remember({ event: 'message', data })
      // the editor's language, which the agent answers in (agents.ts)
      const lang = new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang') === 'de' ? 'de' : 'en'
      if ('send' in agent) agent.send(data, lang, input.action !== undefined)
      else emit(agent, 'message', data)
      send(res, 200, { id })
      return
    }
    if (path === '/__hadley/chat/verdict') {
      const data = verdict(body)
      if (!open.has(data.request_id)) return send(res, 409, { error: 'chat: request_id is not an open request' })
      if (background) {
        open.delete(data.request_id)
        if (!background.verdict(data.request_id, data.allow))
          return send(res, 409, { error: 'chat: request_id is not an open request' })
        return send(res, 200, {})
      }
      if (!channel) return send(res, 503, { error: 'chat: no agent connected' })
      open.delete(data.request_id)
      emit(channel, 'verdict', data)
      send(res, 200, {})
      return
    }
    // the panel starts an agent in the background, or stops it (agents.ts); only its name comes from the browser
    if (path === '/__hadley/chat/agent') {
      const request = object(body, ['run', 'fresh'])
      if (request.fresh !== undefined && typeof request.fresh !== 'boolean')
        throw new Error('fresh: expected a boolean')
      if (request.run === null) {
        await background?.stop()
        return send(res, 200, {})
      }
      if (!isAgentName(request.run)) throw new Error('run: expected claude, codex or null')
      if (!programs[request.run]) return send(res, 404, { error: `chat: ${AGENTS[request.run]} was not found` })
      if (channel) return send(res, 409, { error: 'chat: a session in a terminal is connected', channel: true })
      await startAgent(request.run, request.fresh === true)
      return send(res, 200, {})
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
      } else if (typeof body === 'object' && body !== null && 'event' in body) {
        const envelope = object(body, ['event', 'data'])
        if (envelope.event === 'agent') {
          agentName = agent(envelope.data).name
          broadcast({ event: 'status', data: status() })
        } else if (envelope.event === 'delivered') {
          const data = delivered(envelope.data)
          if (!['message', 'action'].includes(ids.get(data.id) ?? '') || handed.has(data.id))
            return send(res, 409, { error: 'chat: delivered names an unknown or delivered message' })
          handed.add(data.id)
          broadcast({ event: 'delivered', data })
        } else if (envelope.event === 'suggestion') {
          const data = suggestion(envelope.data)
          if (ids.has(data.id) || ids.get(data.to) !== 'action' || answered.has(data.to))
            return send(res, 409, { error: 'chat: suggestion names an unknown or answered action' })
          ids.set(data.id, 'reply')
          answered.add(data.to)
          broadcast({ event: 'suggestion', data })
        } else throw new Error('chat: unknown channel event')
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
          path !== '/__hadley/chat.js' &&
          path !== '/__hadley/chat.css' &&
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
    /** The agent the dev server runs, while it answers a message (editor/history.ts). */
    working(): string | undefined {
      return background?.busy() ? AGENTS[background.name] : undefined
    },
    // the link hadley dev prints in a terminal, and the file that holds the key
    link: `${options.origin}/__hadley/chat/unlock#${browser.key}`,
    keyFile: browser.file,
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
    /** Ends the chat's streams, and the agent in the background: its input closes, which ends it. */
    close(): Promise<void> {
      channel?.end()
      for (const browser of browsers) browser.end()
      browsers.clear()
      rendezvous?.close()
      return background?.stop() ?? Promise.resolve()
    },
  }
}
