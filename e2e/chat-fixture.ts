/** A real hadley dev per test, with builds settled; the fake channel uses hadley channel's rendezvous and SSE. */
import { test as base, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { init } from '../packages/hadley/lib/init.ts'
import { events, Inbox, post } from '../packages/hadley/addons/chat/tests/support.ts'
import { parseRendezvous } from '../packages/hadley/addons/chat/rendezvous.ts'
import { browserKey } from '../packages/hadley/addons/chat/browser-key.ts'

async function unusedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP address')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function startSite() {
  const dir = await mkdtemp(join(tmpdir(), 'hadley-chat-e2e-'))
  const site = join(dir, 'site')
  const runtime = join(dir, 'runtime')
  const port = await unusedPort()
  const origin = `http://localhost:${port}`
  await mkdir(runtime, { mode: 0o700 })
  await init(site, ['en', 'de'], 'hems', 'blank')
  const config = join(site, 'config.lima')
  await writeFile(config, (await readFile(config, 'utf8')) + '\ndev:\n  editor: true\n  chat: true\n')
  const bundle = join(site, 'content', 'articles', '[panel]')
  await mkdir(bundle, { recursive: true })
  await mkdir(join(bundle, 'de'))
  await writeFile(
    join(bundle, 'de', 'panel.md'),
    '---\ntitle: Panel\npublishFrom: 2026-01-01\n---\nErste Wörter des angehängten Blocks.\n',
  )
  const source = join(bundle, 'panel.md')
  await writeFile(
    source,
    '---\ntitle: Panel\npublishFrom: 2026-01-01\n---\nFirst words of the attached block.\n\nSecond block.\n',
  )
  const cli = fileURLToPath(new URL('../packages/hadley/hadley.ts', import.meta.url))
  let child: ReturnType<typeof spawn>
  let exited: Promise<unknown>
  let output = ''
  const waitForBuild = async (since = 0) => {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw new Error(`hadley dev stopped: ${output}`)
          const recent = output.slice(since)
          const start = recent.lastIndexOf('[dev]   Rebuilding (')
          if (start === -1) return false
          const build = recent.slice(start)
          return build.includes('\n  done in ') && build.endsWith('[dev]   (no keyboard: not a terminal)\n')
        },
        { timeout: 45_000, message: 'hadley dev finishes its build and search index' },
      )
      .toBe(true)
  }
  const start = async () => {
    output = ''
    child = spawn('bun', [cli, 'dev', '--port', String(port)], {
      cwd: site,
      env: { ...process.env, XDG_RUNTIME_DIR: runtime, LOCALAPPDATA: runtime, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    exited = once(child, 'exit')
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    await waitForBuild()
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`hadley dev stopped: ${output}`)
          try {
            const response = await fetch(origin + '/panel/', { signal: AbortSignal.timeout(1000) })
            return response.ok && (await response.text()).includes('data-hadley-id')
          } catch {
            return false
          }
        },
        { timeout: 45_000, message: 'hadley dev builds the chat page' },
      )
      .toBe(true)
    // Vite buffers the startup full-reload until its first client, even after the build has finished.
    // Consume it here so the test's first navigation cannot receive that stale reload.
    const messages = new Inbox<MessageEvent>()
    const socket = new WebSocket(origin.replace(/^http/, 'ws'), 'vite-hmr')
    socket.addEventListener('message', (event) => messages.push(event))
    try {
      await messages.next((event) => {
        const data: unknown = JSON.parse(String(event.data))
        return data !== null && typeof data === 'object' && 'type' in data && data.type === 'full-reload'
      })
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) {
        const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) })
        socket.close()
        await closed
      }
    }
  }
  const stop = async () => {
    child.kill('SIGTERM')
    await exited
  }
  try {
    await start()
  } catch (error) {
    await stop()
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  const channels: Awaited<ReturnType<typeof events>>[] = []
  return {
    origin,
    site,
    source,
    config,
    // the site's key to the chat, which hadley dev keeps beside its rendezvous (browser-key.ts)
    key: () => browserKey(join(runtime, 'hadley', 'chat'), site),
    async channel() {
      const record = parseRendezvous(
        JSON.parse(await readFile(join(runtime, 'hadley', 'chat', `${port}.json`), 'utf8')),
      )
      const headers = { 'X-Hadley-Token': record.token }
      const stream = await events(record.origin, '/__hadley/channel/events', headers)
      channels.push(stream)
      // as hadley channel does once Claude Code's initialize names it
      await post(record.origin, '/__hadley/channel', { event: 'agent', data: { name: 'Claude Code' } }, headers)
      return {
        ...stream,
        send: (data: unknown) => post(record.origin, '/__hadley/channel', data, headers),
      }
    },
    async rebuild(write: () => Promise<void>) {
      const since = output.length
      await write()
      await waitForBuild(since)
    },
    async restart(write?: () => Promise<void>) {
      await stop()
      await write?.()
      await start()
    },
    async close() {
      for (const channel of channels) channel.close()
      await stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export const test = base.extend<{ dev: Awaited<ReturnType<typeof startSite>> }>({
  dev: async ({}, use) => {
    const dev = await startSite()
    try {
      await use(dev)
    } finally {
      await dev.close()
    }
  },
  // the browser holds the key, as after the link hadley dev prints; a test without it makes its own context
  page: async ({ page, dev }, use) => {
    const key = dev.key()
    await page
      .context()
      .addCookies([{ name: key.cookie, value: key.key, url: dev.origin, httpOnly: true, sameSite: 'Strict' }])
    await use(page)
  },
})
export { expect }
