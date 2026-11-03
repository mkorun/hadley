import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ViteDevServer } from 'vite'
import { refusal } from '../../../lib/dev-guard.ts'
import { chatPlugin } from '../plugin.ts'
import { sseParser } from '../protocol.ts'

export class Inbox<T> {
  private values: T[] = []
  private events = new EventEmitter()
  push(value: T): void {
    this.values.push(value)
    this.events.emit('item')
  }
  async next(predicate: (value: T) => boolean = () => true): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      for (;;) {
        const index = this.values.findIndex(predicate)
        if (index !== -1) return this.values.splice(index, 1)[0]
        await once(this.events, 'item', { signal: controller.signal })
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export async function devServer(root: string) {
  type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  let middleware: Middleware | undefined
  let chat: ReturnType<typeof chatPlugin> | undefined
  let origin = ''
  const server = http.createServer((req, res) => {
    const refused = refusal(req, req.socket.remoteAddress, { origin, hosts: [], channelToken: chat?.token })
    if (refused) {
      res.writeHead(refused.status)
      res.end(refused.reason)
      return
    }
    middleware!(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  origin = `http://localhost:${port}`
  chat = chatPlugin({ root, site: 'https://site.example', port })
  const configure = chat.plugin.configureServer
  assert.equal(typeof configure, 'function')
  if (typeof configure !== 'function') throw new Error('expected a configureServer hook')
  await configure.call(
    {} as never,
    {
      middlewares: {
        use(handler: Middleware) {
          middleware = handler
        },
      },
    } as unknown as ViteDevServer,
  )
  chat.start()
  return {
    origin,
    port,
    token: chat.token!,
    async close() {
      chat.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

export async function post(
  origin: string,
  path: string,
  data: unknown,
  headers: Record<string, string> = { Origin: origin },
) {
  return await fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })
}

export async function events(origin: string, path: string, headers: Record<string, string> = {}) {
  const inbox = new Inbox<{ event: string; data: unknown }>()
  const request = http.get(origin + path, { headers })
  const [response] = (await once(request, 'response')) as [IncomingMessage]
  assert.equal(response.statusCode, 200)
  response.setEncoding('utf8')
  const parse = sseParser((event, data) => inbox.push({ event, data }))
  response.on('data', (chunk: string) => parse(chunk))
  return {
    inbox,
    response,
    close() {
      response.destroy()
      request.destroy()
    },
  }
}
