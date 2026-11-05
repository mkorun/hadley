import assert from 'node:assert/strict'
import { it } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { certificateFingerprint, directories, parseRendezvous } from '../rendezvous.ts'
import { browserKey } from '../browser-key.ts'
import { channelProcess, events, Inbox, post } from './support.ts'
import { testCertificate } from './certificate.ts'

async function start(config: string, certificate?: ReturnType<typeof testCertificate>) {
  const root = mkdtempSync(join(tmpdir(), 'hadley-chat-dev-'))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root, LOCALAPPDATA: root }
  const probe = createServer().listen(0, 'localhost')
  await once(probe, 'listening')
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  writeFileSync(join(root, 'config.lima'), `site:\n  origin: https://site.example\ndev:\n${config}`)
  if (certificate) {
    mkdirSync(join(root, 'hadley'), { mode: 0o700 })
    writeFileSync(join(root, 'test-cert.pem'), certificate.cert, { mode: 0o600 })
    writeFileSync(join(root, 'test-key.pem'), certificate.key, { mode: 0o600 })
    writeFileSync(
      join(root, 'hadley', 'config.lima'),
      'dev:\n  https:\n    cert: ../test-cert.pem\n    key: ../test-key.pem\n',
    )
  }
  const source = `import { startDevServer } from ${JSON.stringify(fileURLToPath(new URL('../../../lib/dev-server.ts', import.meta.url)))};
    try {
      await startDevServer({ siteDir: ${JSON.stringify(root)}, outputMode: 'dev',
        serve: { port: ${port}, https: ${certificate !== undefined}, host: false }, noBuild: true, noWatch: true });
      console.log('TEST_READY');
    } catch (error) { console.error(error.message); process.exitCode = 1 }`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env, stdio: 'pipe', timeout: 20_000 })
  const lines = new Inbox<string>()
  const output = createInterface({ input: child.stdout })
  output.on('line', (line) => lines.push(line))
  let errors = ''
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString()
  })
  const exited = once(child, 'exit')
  return {
    child,
    root,
    port,
    env,
    exited,
    lines,
    origin: `${certificate ? 'https' : 'http'}://localhost:${port}`,
    errors: () => errors,
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await exited
      }
      output.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

it(
  'serves the chat before the editor middleware and removes rendezvous on SIGINT and SIGTERM',
  { timeout: 30_000 },
  async () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const dev = await start('  editor: true\n  chat: true\n')
      try {
        await dev.lines.next((line) => line === 'TEST_READY')
        const paths = directories(dev.env)
        const record = join(paths[paths.length - 1], `${dev.port}.json`)
        assert.ok(existsSync(record))
        // the chat's routes answer only a browser that holds the site's key
        const key = browserKey(paths[paths.length - 1], dev.root)
        assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' })).status, 401)
        // the link's page holds no key (it is in the fragment, which no request carries) and sets no cookie,
        // which every port of localhost would get
        const link = await fetch(`${dev.origin}/__hadley/chat/unlock`, { redirect: 'manual' })
        assert.equal(link.status, 200)
        assert.equal(link.headers.get('set-cookie'), null)
        // no frame may hold it, and it sends no Referer
        assert.equal(link.headers.get('content-security-policy'), "frame-ancestors 'none'")
        assert.equal(link.headers.get('referrer-policy'), 'no-referrer')
        const page = await link.text()
        assert.ok(page.includes("localStorage.setItem('hadley-chat-key'"))
        assert.ok(!page.includes(key.key))
        const keyed = { Origin: dev.origin, 'X-Hadley-Key': key.key }
        assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' }, keyed)).status, 503)
        const info = parseRendezvous(JSON.parse(readFileSync(record, 'utf8')))
        assert.equal(info.origin, dev.origin)
        assert.equal(info.fingerprint, undefined)
        const token = info.token
        const controller = new AbortController()
        try {
          const stream = await fetch(dev.origin + '/__hadley/channel/events', {
            headers: { 'X-Hadley-Token': token },
            signal: controller.signal,
          })
          assert.equal(stream.status, 200)
          assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' }, keyed)).status, 200)
        } finally {
          controller.abort()
        }
        dev.child.kill(signal)
        const [code] = await dev.exited
        assert.equal(existsSync(record), false)
        assert.ok(code === 0 || code === 128 + (signal === 'SIGINT' ? 2 : 15), dev.errors())
      } finally {
        await dev.close()
      }
    }
  },
)

it('loads no chat without dev.chat, and refuses chat without editor before serving', { timeout: 30_000 }, async () => {
  const off = await start('  editor: true\n')
  try {
    await off.lines.next((line) => line === 'TEST_READY')
    assert.equal(existsSync(directories(off.env)[0]), false)
    assert.equal((await post(off.origin, '/__hadley/chat', { text: 'hello', page: '/' })).status, 404)
    assert.equal((await fetch(off.origin + '/__hadley/channel/events')).status, 403)
  } finally {
    await off.close()
  }
  const invalid = await start('  chat: true\n')
  try {
    assert.equal((await invalid.exited)[0], 1)
    assert.match(invalid.errors(), /dev\.chat: true requires dev\.editor: true/)
    await assert.rejects(fetch(invalid.origin))
  } finally {
    await invalid.close()
  }
})

it(
  'publishes the HTTPS origin and exact certificate pin used by the real dev server',
  { timeout: 30_000 },
  async () => {
    const certificate = testCertificate()
    const dev = await start('  editor: true\n  chat: true\n', certificate)
    let channel: ReturnType<typeof channelProcess> | undefined
    let browser: Awaited<ReturnType<typeof events>> | undefined
    try {
      await dev.lines.next((line) => line === 'TEST_READY')
      const paths = directories(dev.env)
      const record = parseRendezvous(
        JSON.parse(readFileSync(join(paths[paths.length - 1], `${dev.port}.json`), 'utf8')),
      )
      assert.equal(record.origin, dev.origin)
      assert.equal(record.fingerprint, certificateFingerprint(certificate.cert))
      const key = browserKey(paths[paths.length - 1], dev.root)
      browser = await events(dev.origin, `/__hadley/chat/events?key=${key.key}`)
      channel = channelProcess(dev.root)
      await browser.inbox.next((entry) => entry.event === 'status' && (entry.data as { connected: boolean }).connected)
      channel.rpc('tools/call', 1, { _meta: { progressToken: 1 }, name: 'reply', arguments: { text: 'HTTPS reply' } })
      assert.ok((await channel.stdout.next()).result)
      assert.equal(
        ((await browser.inbox.next((entry) => entry.event === 'reply')).data as { text: string }).text,
        'HTTPS reply',
      )
    } finally {
      try {
        await channel?.close()
      } finally {
        browser?.close()
        await dev.close()
      }
    }
  },
)
