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

async function startSite(theme: string) {
  const dir = await mkdtemp(join(tmpdir(), 'hadley-chat-e2e-'))
  const site = join(dir, 'site')
  const runtime = join(dir, 'runtime')
  const port = await unusedPort()
  const origin = `http://localhost:${port}`
  await mkdir(runtime, { mode: 0o700 })
  // the agents the chat starts itself are stand-ins (addons/chat/tests/fake-agents), never the user's programs
  const configHome = join(dir, 'config')
  const bin = join(dir, 'bin')
  await mkdir(join(configHome, 'hadley'), { recursive: true })
  await mkdir(bin)
  for (const name of ['claude', 'codex']) {
    const fake = fileURLToPath(new URL(`../packages/hadley/addons/chat/tests/fake-agents/${name}.mjs`, import.meta.url))
    await writeFile(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 })
  }
  await writeFile(
    join(configHome, 'hadley', 'config.lima'),
    `dev:\n  claude: ${join(bin, 'claude')}\n  codex: ${join(bin, 'codex')}\n`,
  )
  await init(site, ['en', 'de'], theme, 'blank')
  const config = join(site, 'config.lima')
  const settings = await readFile(config, 'utf8')
  // no search: hadley dev writes its index after the reload of a rebuild, and Vite's import analysis of the theme's
  // search.js puts its overlay over the page while the index is missing (seen once in WebKit, 2026-11-08); no test here
  // searches
  const search = 'search:\n  enabled: true'
  if (!settings.includes(search)) throw new Error('the blank starter no longer turns the search on')
  await writeFile(
    config,
    settings.replace(search, 'search:\n  enabled: false') + '\ndev:\n  editor: true\n  chat: true\n',
  )
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
        { timeout: 45_000, message: 'hadley dev finishes its build' },
      )
      .toBe(true)
  }
  const start = async () => {
    output = ''
    child = spawn('bun', [cli, 'dev', '--port', String(port)], {
      cwd: site,
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: runtime,
        LOCALAPPDATA: runtime,
        XDG_CONFIG_HOME: configHome,
        NO_COLOR: '1',
      },
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

export const test = base.extend<{ theme: string; dev: Awaited<ReturnType<typeof startSite>> }>({
  // the site's theme (packages/hadley/themes/), with its blank starter
  theme: ['hems', { option: true }],
  dev: async ({ theme }, use) => {
    const dev = await startSite(theme)
    try {
      await use(dev)
    } finally {
      await dev.close()
    }
  },
  // the browser holds the key, as after the link hadley dev prints (the chat keeps it in the origin's storage); a test
  // without it makes its own context
  page: async ({ page, dev }, use) => {
    const { key } = dev.key()
    await page.addInitScript((value) => {
      try {
        globalThis.localStorage.setItem('hadley-chat-key', value)
      } catch {
        // a page without storage, such as about:blank
      }
    }, key)
    await use(page)
  },
})
export { expect }
