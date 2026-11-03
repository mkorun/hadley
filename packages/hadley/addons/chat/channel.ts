import { watch, type FSWatcher } from 'node:fs'
import http, { type ClientRequest, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { createInterface } from 'node:readline'
import { Transform } from 'node:stream'
import type { TLSSocket } from 'node:tls'
import { certificateFingerprint, readRendezvous, rendezvousDirectory, type Rendezvous } from './rendezvous.ts'
import {
  MAX_BYTES,
  message,
  newId,
  object,
  parseJson,
  permission,
  reply,
  sseParser,
  text,
  verdict,
} from './protocol.ts'

const INSTRUCTIONS =
  'Messages come from the site author in the hadley block editor as <channel source="hadley" …>. ' +
  'file is relative to the site in site; url is the page the author is reading. ' +
  'Answer only with reply, passing message_id: the author reads the panel, not the terminal. ' +
  'Re-read a file before changing it; the author edits it in the editor at the same time.'

interface Connection {
  record: Rendezvous
  request?: ClientRequest | undefined
  response?: IncomingMessage | undefined
  connected: boolean
  retryAt: number
  failures: number
}

/** Send the token only after TLS has matched the leaf certificate recorded by the dev server. */
export function channelRequest(record: Rendezvous, path: string, body?: string): ClientRequest {
  const secure = record.origin.startsWith('https:')
  const request = (secure ? https : http).request(new URL(path, record.origin), {
    method: body === undefined ? 'GET' : 'POST',
    // A fresh TLS socket always emits secureConnect; no pooled connection bypasses the pin check.
    agent: false,
    ...(secure ? { rejectUnauthorized: false } : {}),
    headers: { 'X-Hadley-Token': record.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  })
  if (secure) {
    request.once('socket', (socket) => {
      const tls = socket as TLSSocket
      tls.once('secureConnect', () => {
        try {
          const certificate = tls.getPeerCertificate().raw
          if (!certificate || certificateFingerprint(certificate) !== record.fingerprint)
            throw new Error('dev server certificate does not match the rendezvous fingerprint')
          // Only this pin authorizes the certificate. No HTTP bytes precede this check.
          request.end(body)
        } catch (error) {
          request.destroy(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  } else request.end(body)
  return request
}

/** Claude Code owns stdio and the lifetime. Nothing starts when this module is imported. */
export async function runChannel(
  watchDirectory: (dir: string, listener: () => void) => FSWatcher = watch,
): Promise<void> {
  const connections = new Map<number, Connection>()
  const routes = new Map<string, Connection>()
  const requests = new Set<ClientRequest>()
  let stopped = false
  let watcher: FSWatcher | undefined
  const reported = new Map<string, string>()
  const diagnostic = (error: unknown) =>
    console.error(`hadley channel: ${error instanceof Error ? error.message : error}`)
  const write = (data: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...data }) + '\n')
  const notify = (method: string, params: object) => write({ method, params })

  function reportOnce(key: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (reported.get(key) === message) return
    reported.set(key, message)
    diagnostic(message)
  }

  function receive(connection: Connection, event: string, value: unknown): void {
    if (event === 'message') {
      const data = message(value)
      if (data.site !== connection.record.site) throw new Error('message.site differs from the rendezvous site')
      if (routes.has(data.id)) throw new Error('duplicate message id')
      routes.set(data.id, connection)
      const { id, text: content, ...meta } = data
      notify('notifications/claude/channel', { content, meta: { message_id: id, ...meta } })
    } else if (event === 'verdict') {
      const data = verdict(value)
      notify('notifications/claude/channel/permission', {
        request_id: data.request_id,
        behavior: data.allow ? 'allow' : 'deny',
      })
    } else throw new Error(`unknown channel event: ${event}`)
  }

  function connect(connection: Connection): void {
    const { record } = connection
    const request = channelRequest(record, '/__hadley/channel/events')
    connection.request = request
    requests.add(request)
    // Only the handshake times out; an idle channel is a healthy long-lived SSE connection.
    const timeout = setTimeout(() => request.destroy(new Error('channel connection timed out')), 10_000)
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      requests.delete(request)
      connection.connected = false
      connection.request = undefined
      connection.response = undefined
      connection.retryAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(connection.failures++, 5))
      if (error && !stopped) diagnostic(`port ${record.port}: ${error.message}`)
    }
    request.once('error', finish)
    request.once('response', (response) => {
      clearTimeout(timeout)
      if (response.statusCode !== 200 || !response.headers['content-type']?.startsWith('text/event-stream')) {
        response.destroy()
        finish(new Error(`channel events: expected SSE, got HTTP ${response.statusCode}`))
        return
      }
      connection.response = response
      connection.connected = true
      connection.failures = 0
      response.setEncoding('utf8')
      const parse = sseParser((event, data) => receive(connection, event, data))
      response.on('data', (chunk: string) => {
        try {
          parse(chunk)
        } catch (error) {
          diagnostic(error)
          response.destroy()
        }
      })
      response.once('error', finish)
      response.once('close', () => finish())
    })
  }

  function rescan(): void {
    if (stopped) return
    const dir = rendezvousDirectory()
    const records = readRendezvous(dir, reportOnce)
    if (!watcher) {
      try {
        const current = watchDirectory(dir, scan)
        watcher = current
        current.on('error', (error) => {
          reportOnce('watch', error)
          current.close()
          if (watcher === current) watcher = undefined
        })
      } catch (error) {
        reportOnce('watch', error)
      }
    }
    for (const [port, connection] of connections) {
      if (
        !records.some(
          (record) =>
            record.port === port &&
            record.token === connection.record.token &&
            record.origin === connection.record.origin &&
            record.fingerprint === connection.record.fingerprint &&
            record.pid === connection.record.pid &&
            record.site === connection.record.site &&
            record.root === connection.record.root,
        )
      ) {
        connection.request?.destroy()
        connection.response?.destroy()
        connections.delete(port)
        for (const [id, target] of routes) if (target === connection) routes.delete(id)
      }
    }
    for (const record of records) {
      let connection = connections.get(record.port)
      if (!connection) {
        connection = { record, connected: false, retryAt: 0, failures: 0 }
        connections.set(record.port, connection)
      }
      if (!connection.request && Date.now() >= connection.retryAt) connect(connection)
    }
  }

  async function post(connection: Connection, data: object): Promise<void> {
    if (!connection.connected) throw new Error(`port ${connection.record.port}: channel is disconnected`)
    await new Promise<void>((resolve, reject) => {
      const request = channelRequest(connection.record, '/__hadley/channel', JSON.stringify(data))
      request.once('response', (response) => {
        response.resume()
        response.once('end', () => {
          if (response.statusCode === 200) resolve()
          else reject(new Error(`port ${connection.record.port}: channel POST returned HTTP ${response.statusCode}`))
        })
        response.once('error', reject)
      })
      requests.add(request)
      const timeout = setTimeout(() => request.destroy(new Error('channel POST timed out')), 10_000)
      request.once('close', () => {
        clearTimeout(timeout)
        requests.delete(request)
      })
      request.once('error', reject)
    })
  }

  async function broadcast(data: object): Promise<void> {
    const targets = [...connections.values()].filter((connection) => connection.connected)
    if (!targets.length) throw new Error('no dev server connected')
    const results = await Promise.allSettled(targets.map((connection) => post(connection, data)))
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }

  async function handle(value: unknown): Promise<void> {
    const rpc = object(value)
    if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw new Error('expected a JSON-RPC 2.0 method')
    const id = rpc.id
    if (id !== undefined && typeof id !== 'string' && typeof id !== 'number') throw new Error('invalid JSON-RPC id')
    try {
      let result: object
      switch (rpc.method) {
        case 'initialize': {
          const params = object(rpc.params)
          result = {
            protocolVersion: text(params.protocolVersion, 'protocolVersion'),
            capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} },
            serverInfo: { name: 'hadley', version: '1' },
            instructions: INSTRUCTIONS,
          }
          break
        }
        case 'tools/list':
          result = {
            tools: [
              {
                name: 'reply',
                description: 'Answer the site author in the hadley editor panel',
                inputSchema: {
                  type: 'object',
                  properties: { message_id: { type: 'string' }, text: { type: 'string' } },
                  required: ['text'],
                  additionalProperties: false,
                },
              },
            ],
          }
          break
        case 'tools/call': {
          const params = object(rpc.params, ['name', 'arguments'])
          if (params.name !== 'reply') throw new Error('unknown tool: expected reply')
          const args = object(params.arguments, ['message_id', 'text'])
          const data = reply({
            id: newId(),
            text: args.text,
            ...(args.message_id === undefined ? {} : { to: args.message_id }),
          })
          if (data.to !== undefined) {
            const target = routes.get(data.to)
            if (!target) throw new Error('message_id: unknown message')
            await post(target, data)
          } else await broadcast(data)
          result = { content: [{ type: 'text', text: 'shown in the editor' }] }
          break
        }
        case 'notifications/claude/channel/permission_request': {
          const data = permission(rpc.params)
          await broadcast(data)
          return
        }
        case 'ping':
          result = {}
          break
        default:
          if (id !== undefined) write({ id, error: { code: -32601, message: `method not found: ${rpc.method}` } })
          return
      }
      if (id !== undefined) write({ id, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (id !== undefined) write({ id, error: { code: -32602, message } })
      else diagnostic(message)
    }
  }

  // Bound an unfinished line too; readline alone would retain it until a newline arrives.
  let lineBytes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      for (const byte of chunk) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1
        if (lineBytes > MAX_BYTES) return callback(new Error('JSON-RPC line too large'))
      }
      try {
        callback(null, decoder.decode(chunk, { stream: true }))
      } catch {
        callback(new Error('JSON-RPC input is not valid UTF-8'))
      }
    },
    flush(callback) {
      try {
        callback(null, decoder.decode())
      } catch {
        callback(new Error('JSON-RPC input is not valid UTF-8'))
      }
    },
  })
  const input = createInterface({ input: bounded, crlfDelay: Infinity })
  process.stdin.pipe(bounded)
  const stop = () => {
    if (stopped) return
    stopped = true
    watcher?.close()
    clearInterval(interval)
    for (const request of requests) request.destroy()
    for (const connection of connections.values()) connection.response?.destroy()
    input.close()
    process.stdin.unpipe(bounded)
    bounded.destroy()
    process.stdin.destroy()
  }
  const scan = () => {
    try {
      rescan()
    } catch (error) {
      reportOnce('directory', error)
      watcher?.close()
      watcher = undefined
    }
  }
  bounded.on('error', (error) => {
    diagnostic(error)
    process.exitCode = 1
    stop()
  })
  const interval = setInterval(scan, 3_000)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    scan()
    for await (const line of input) {
      if (!line.trim()) continue
      try {
        if (Buffer.byteLength(line) > MAX_BYTES) throw new Error('JSON-RPC line too large')
        await handle(parseJson(line, 'JSON-RPC'))
      } catch (error) {
        write({ id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } })
      }
    }
  } finally {
    stop()
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

if (import.meta.main) {
  runChannel().catch((error: unknown) => {
    console.error(`hadley channel: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
