import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
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

/** Bun 1.4.0 (scripts/build-binary.ts) needs close to start before connections are forced closed. */
export async function closeServer(server: Pick<http.Server, 'close' | 'closeAllConnections'>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
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
  chat = chatPlugin({ root, site: 'https://site.example', port, origin })
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
      await closeServer(server)
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
  const secure = new URL(origin).protocol === 'https:'
  const request = (secure ? https : http).get(origin + path, {
    headers,
    ...(secure ? { rejectUnauthorized: false } : {}),
  })
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

export function channelProcess(root: string, watchErrors = false) {
  const module = fileURLToPath(new URL('../channel.ts', import.meta.url))
  const watcher = `import { watch } from 'node:fs'; import { runChannel } from ${JSON.stringify(module)};
    let attempt = 0;
    await runChannel((dir, listener) => {
      if (++attempt === 1) throw new Error('test watcher could not start');
      const watcher = watch(dir, listener);
      queueMicrotask(() => watcher.emit('error', new Error('test watcher failed')));
      return watcher;
    });`
  const child = spawn(process.execPath, watchErrors ? ['--input-type=module', '-e', watcher] : [module], {
    env: { ...process.env, XDG_RUNTIME_DIR: root, LOCALAPPDATA: root },
    stdio: 'pipe',
    timeout: 25_000,
  })
  const exited = once(child, 'exit')
  const stdout = new Inbox<Record<string, unknown>>()
  const stderr = new Inbox<string>()
  const diagnostics: string[] = []
  const output = createInterface({ input: child.stdout })
  const errors = createInterface({ input: child.stderr })
  output.on('line', (line) => stdout.push(JSON.parse(line) as Record<string, unknown>))
  errors.on('line', (line) => {
    diagnostics.push(line)
    stderr.push(line)
  })
  return {
    stdout,
    stderr,
    diagnostics,
    rpc(method: string, id: number, params?: object) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, id, ...(params ? { params } : {}) }) + '\n')
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end()
      const [code] = await exited
      output.close()
      errors.close()
      assert.equal(code, 0, diagnostics.join('\n'))
    },
  }
}
