import assert from 'node:assert/strict'
import { it } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { certificateFingerprint, createRendezvous, rendezvousDirectory } from '../rendezvous.ts'
import { sse } from '../protocol.ts'
import { channelProcess, closeServer, Inbox } from './support.ts'
import { testCertificate } from './certificate.ts'
import { channelRequest } from '../channel.ts'

async function fakeDevServer(
  dir: string,
  root: string,
  site: string,
  certificate?: ReturnType<typeof testCertificate>,
) {
  const streams = new Inbox<ServerResponse>()
  const posts = new Inbox<unknown>()
  let token = ''
  let requestCount = 0
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    requestCount++
    assert.equal(req.headers['x-hadley-token'], token)
    assert.equal(req.headers.origin, undefined)
    if (req.url === '/__hadley/channel/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': connected\n\n')
      streams.push(res)
    } else if (req.url === '/__hadley/channel' && req.method === 'POST') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        body += chunk
      })
      req.once('end', () => {
        posts.push(JSON.parse(body) as unknown)
        res.end('{}')
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  }
  const secureServer = certificate ? https.createServer(certificate, handle) : undefined
  const server = secureServer ?? http.createServer(handle)
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  const rendezvous = createRendezvous(
    {
      port,
      site,
      root,
      origin: `${certificate ? 'https' : 'http'}://localhost:${port}`,
      ...(certificate ? { fingerprint: certificateFingerprint(certificate.cert) } : {}),
    },
    dir,
  )
  token = rendezvous.record.token
  return {
    streams,
    posts,
    record: rendezvous.record,
    get requestCount() {
      return requestCount
    },
    async close() {
      rendezvous.close()
      await closeServer(server)
    },
  }
}

it(
  'speaks the probed Claude Code handshake and routes messages, replies, permissions and reconnections over stdio',
  { timeout: 30_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-channel-test-'))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, LOCALAPPDATA: root }
    const dir = rendezvousDirectory(env)
    const first = await fakeDevServer(dir, root, 'https://first.example')
    let second: Awaited<ReturnType<typeof fakeDevServer>> | undefined
    const child = spawn(process.execPath, [fileURLToPath(new URL('../channel.ts', import.meta.url))], {
      env,
      stdio: 'pipe',
      timeout: 25_000,
    })
    const exited = once(child, 'exit')
    const stdout = new Inbox<Record<string, unknown>>()
    const output = createInterface({ input: child.stdout })
    output.on('line', (line) => stdout.push(JSON.parse(line) as Record<string, unknown>))
    let diagnostics = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      diagnostics += chunk
    })
    const rpc = (method: string, id?: number, params?: object) =>
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method,
          ...(id === undefined ? {} : { id }),
          ...(params === undefined ? {} : { params }),
        }) + '\n',
      )
    try {
      child.stdin.write('{bad json}\n')
      assert.equal((await stdout.next()).id, null)
      rpc('initialize', 1, { protocolVersion: '2025-06-18' })
      const init = await stdout.next()
      assert.equal(init.jsonrpc, '2.0')
      const result = init.result as { protocolVersion: string; capabilities: unknown; instructions: string }
      assert.equal(result.protocolVersion, '2025-06-18')
      assert.deepEqual(result.capabilities, {
        experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
        tools: {},
      })
      for (const instruction of ['<channel source="hadley"', 'relative', 'reply', 'message_id', 'Re-read'])
        assert.ok(result.instructions.includes(instruction))
      rpc('server/discover', 2)
      assert.deepEqual((await stdout.next()).error, { code: -32601, message: 'method not found: server/discover' })
      rpc('tools/list', 3)
      assert.equal(((await stdout.next()).result as { tools: { name: string }[] }).tools[0].name, 'reply')
      rpc('ping', 4)
      assert.deepEqual((await stdout.next()).result, {})
      let stream = await first.streams.next()
      const data = {
        id: 'abcdefgh',
        text: 'Explain this',
        site: 'https://first.example',
        url: 'https://first.example/page/',
        file: 'content/page/index.md',
        block: 'block',
        lines: '12-15',
      }
      // UTF-8 is decoded by IncomingMessage even when the transport splits it.
      stream.write(sse('message', data).slice(0, 19))
      stream.write(sse('message', data).slice(19))
      assert.deepEqual(await stdout.next(), {
        jsonrpc: '2.0',
        method: 'notifications/claude/channel',
        params: {
          content: data.text,
          meta: {
            message_id: data.id,
            site: data.site,
            url: data.url,
            file: data.file,
            block: data.block,
            lines: data.lines,
          },
        },
      })
      // The directory watch discovers a server started after the MCP session.
      second = await fakeDevServer(dir, root, 'https://second.example')
      const other = await second.streams.next()
      other.write(
        sse('message', {
          id: 'ijklmnop',
          text: 'Other site',
          site: 'https://second.example',
          url: 'https://second.example/',
        }),
      )
      const otherMessage = (await stdout.next()).params as { meta: Record<string, string> }
      assert.deepEqual(otherMessage.meta, {
        message_id: 'ijklmnop',
        site: 'https://second.example',
        url: 'https://second.example/',
      })
      rpc('tools/call', 5, { name: 'reply', arguments: { message_id: data.id, text: 'Answer' } })
      const targeted = (await first.posts.next()) as { id: string; to: string; text: string }
      assert.match(targeted.id, /^[a-z0-9]{8}$/)
      assert.equal(targeted.to, data.id)
      assert.equal(targeted.text, 'Answer')
      assert.ok((await stdout.next()).result)
      rpc('tools/call', 6, { name: 'reply', arguments: { text: 'To both' } })
      for (const fake of [first, second]) assert.equal(((await fake.posts.next()) as { text: string }).text, 'To both')
      assert.ok((await stdout.next()).result)
      rpc('tools/call', 7, { name: 'reply', arguments: { message_id: 'zzzzzzzz', text: 'Unknown' } })
      assert.match(((await stdout.next()).error as { message: string }).message, /unknown message/)
      const captured = {
        request_id: 'jdgkp',
        tool_name: 'Write',
        description: 'Write a file to the local filesystem.',
        input_preview: '{ "file_path": "/tmp/x/relay-test-2.txt", "content": "relay 2 ok" }',
      }
      const permission = {
        request_id: captured.request_id,
        tool: captured.tool_name,
        description: captured.description,
        preview: captured.input_preview,
      }
      rpc('notifications/claude/channel/permission_request', undefined, captured)
      for (const fake of [first, second]) assert.deepEqual(await fake.posts.next(), permission)
      stream.write(sse('verdict', { request_id: 'jdgkp', allow: true }))
      assert.deepEqual(await stdout.next(), {
        jsonrpc: '2.0',
        method: 'notifications/claude/channel/permission',
        params: { request_id: 'jdgkp', behavior: 'allow' },
      })
      rpc('notifications/claude/channel/permission_request', undefined, {
        ...captured,
        request_id: 'bcdef',
        future_field: 'ignored',
      })
      for (const fake of [first, second])
        assert.deepEqual(await fake.posts.next(), { ...permission, request_id: 'bcdef' })
      other.write(sse('verdict', { request_id: 'bcdef', allow: false }))
      assert.equal(((await stdout.next()).params as { behavior: string }).behavior, 'deny')
      stream.destroy()
      stream = await first.streams.next()
      stream.write(sse('message', { ...data, id: 'qrstuvwx' }))
      assert.equal(((await stdout.next()).params as { meta: { message_id: string } }).meta.message_id, 'qrstuvwx')
      child.stdin.end()
      const [code, signal] = await exited
      assert.equal(code, 0, diagnostics)
      assert.equal(signal, null)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await exited
      }
      output.close()
      await first.close()
      await second?.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

it('refuses a permission notification without tool_name over stdio', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hadley-channel-permission-'))
  const dir = rendezvousDirectory({ XDG_RUNTIME_DIR: root, LOCALAPPDATA: root })
  const server = await fakeDevServer(dir, root, 'https://site.example')
  const child = channelProcess(root)
  try {
    await server.streams.next()
    child.rpc('notifications/claude/channel/permission_request', undefined, {
      request_id: 'jdgkp',
      tool: 'Write',
      description: 'Write a file to the local filesystem.',
      input_preview: '{}',
    })
    assert.match(await child.stderr.next(), /tool: expected nonempty text/)
    // A following reply proves that the refused notification never reached the dev server.
    child.rpc('tools/call', 1, { name: 'reply', arguments: { text: 'Still connected' } })
    assert.equal(((await server.posts.next()) as { text: string }).text, 'Still connected')
    assert.ok((await child.stdout.next()).result)
  } finally {
    await child.close()
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it('hadley channel --help needs no site and writes no protocol traffic', async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../../hadley.ts', import.meta.url)), 'channel', '--help'],
    { timeout: 10_000, stdio: 'pipe' },
  )
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString()
  })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, errors)
  assert.match(output, /Claude Code starts this MCP server over stdio/)
  assert.equal(errors, '')
})

for (const [name, input, expected] of [
  ['bounds an unfinished JSON-RPC line', 'x'.repeat(1_048_577), /JSON-RPC line too large/],
  ['refuses malformed UTF-8 on stdio', Buffer.from([0xff, 10]), /not valid UTF-8/],
] as const)
  it(name, async () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-channel-bound-'))
    const child = spawn(process.execPath, [fileURLToPath(new URL('../channel.ts', import.meta.url))], {
      env: { ...process.env, XDG_RUNTIME_DIR: root, LOCALAPPDATA: root },
      stdio: 'pipe',
      timeout: 10_000,
    })
    const exited = once(child, 'exit')
    let diagnostic = ''
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic += chunk.toString()
    })
    // The child can close stdin while the parent is still writing the rejected line.
    child.stdin.on('error', () => {})
    child.stdout.resume()
    try {
      child.stdin.write(input)
      assert.equal((await exited)[0], 1)
      assert.match(diagnostic, expected)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
        await exited
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

it('uses the recorded HTTPS origin and certificate for both events and replies', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hadley-channel-https-'))
  const dir = rendezvousDirectory({ XDG_RUNTIME_DIR: root, LOCALAPPDATA: root })
  const server = await fakeDevServer(dir, root, 'https://secure.example', testCertificate())
  const path = join(dir, `${server.record.port}.json`)
  writeFileSync(path, JSON.stringify({ ...server.record, fingerprint: '0'.repeat(64) }))
  const channel = channelProcess(root)
  try {
    await channel.stderr.next((line) => line.includes('does not match the rendezvous fingerprint'))
    assert.equal(server.requestCount, 0, 'a wrong certificate must receive neither a request nor the token')
    channel.rpc('ping', 1)
    assert.equal((await channel.stdout.next()).id, 1)
    writeFileSync(path, JSON.stringify(server.record))
    const stream = await server.streams.next()
    stream.write(
      sse('message', { id: 'abcdefgh', text: 'Secure', site: server.record.site, url: server.record.site + '/' }),
    )
    assert.equal((await channel.stdout.next()).method, 'notifications/claude/channel')
    channel.rpc('tools/call', 2, { name: 'reply', arguments: { message_id: 'abcdefgh', text: 'Pinned reply' } })
    assert.equal(((await server.posts.next()) as { text: string }).text, 'Pinned reply')
    assert.ok((await channel.stdout.next()).result)
    const requestsBefore = server.requestCount
    const request = channelRequest(
      { ...server.record, fingerprint: '0'.repeat(64) },
      '/__hadley/channel',
      JSON.stringify({ id: 'ijklmnop', to: 'abcdefgh', text: 'Must not arrive' }),
    )
    request.setTimeout(10_000, () => request.destroy(new Error('test request timed out')))
    const error = await new Promise<Error>((resolve, reject) => {
      request.once('error', resolve)
      request.once('response', (response) => {
        response.resume()
        reject(new Error('a mismatched certificate received the POST'))
      })
    })
    assert.match(error.message, /does not match the rendezvous fingerprint/)
    assert.equal(server.requestCount, requestsBefore, 'POST must check its own TLS socket before sending the token')
  } finally {
    await channel.close()
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it(
  'keeps a session alive across bad records and retries a broken directory without repeated diagnostics',
  { timeout: 30_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-channel-rescan-'))
    const dir = rendezvousDirectory({ XDG_RUNTIME_DIR: root, LOCALAPPDATA: root })
    const server = await fakeDevServer(dir, root, 'https://first.example')
    const bad = join(dir, '1.json')
    writeFileSync(bad, '{', { mode: 0o600 })
    const shared = join(dir, '2.json')
    writeFileSync(shared, JSON.stringify({ ...server.record, port: 2, origin: 'http://localhost:2' }), { mode: 0o600 })
    if (process.platform !== 'win32') chmodSync(shared, 0o644)
    else writeFileSync(shared, '{}')
    const channel = channelProcess(root)
    let second: Awaited<ReturnType<typeof fakeDevServer>> | undefined
    try {
      const stream = await server.streams.next()
      await channel.stderr.next((line) => line.includes('1.json:'))
      await channel.stderr.next((line) => line.includes('2.json:'))
      // A new server forces another scan of the same bad files.
      second = await fakeDevServer(dir, root, 'https://second.example')
      await second.streams.next()
      if (process.platform !== 'win32') {
        chmodSync(dir, 0o755)
        writeFileSync(bad, '{')
        await channel.stderr.next((line) => line.includes(`${dir} must belong`))
      }
      stream.write(
        sse('message', {
          id: 'abcdefgh',
          text: 'Still connected',
          site: server.record.site,
          url: server.record.site + '/',
        }),
      )
      assert.equal((await channel.stdout.next()).method, 'notifications/claude/channel')
      // Existing streams continue to work, and the next periodic rescan discovers a repaired record.
      if (process.platform !== 'win32') chmodSync(dir, 0o700)
      writeFileSync(bad, JSON.stringify({ ...server.record, port: 1, origin: 'http://localhost:1', pid: 0 }))
      await channel.stderr.next((line) => line.includes('1.json: pid:'))
      channel.rpc('ping', 1)
      assert.equal((await channel.stdout.next()).id, 1)
      assert.equal(channel.diagnostics.filter((line) => line.includes('1.json: rendezvous: invalid JSON')).length, 1)
      assert.equal(channel.diagnostics.filter((line) => line.includes('2.json:')).length, 1)
      if (process.platform !== 'win32')
        assert.equal(channel.diagnostics.filter((line) => line.includes(`${dir} must belong`)).length, 1)
    } finally {
      if (process.platform !== 'win32') chmodSync(dir, 0o700)
      const closed = await Promise.allSettled([channel.close(), server.close(), second?.close()])
      rmSync(root, { recursive: true, force: true })
      for (const result of closed) if (result.status === 'rejected') throw result.reason
    }
  },
)

it('continues polling after watcher creation and asynchronous watcher failures', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hadley-channel-watch-'))
  const dir = rendezvousDirectory({ XDG_RUNTIME_DIR: root, LOCALAPPDATA: root })
  const server = await fakeDevServer(dir, root, 'https://first.example')
  const channel = channelProcess(root, true)
  let second: Awaited<ReturnType<typeof fakeDevServer>> | undefined
  try {
    await server.streams.next()
    await channel.stderr.next((line) => line.includes('test watcher could not start'))
    await channel.stderr.next((line) => line.includes('test watcher failed'))
    second = await fakeDevServer(dir, root, 'https://second.example')
    const stream = await second.streams.next()
    stream.write(
      sse('message', {
        id: 'abcdefgh',
        text: 'Polling works',
        site: second.record.site,
        url: second.record.site + '/',
      }),
    )
    assert.equal((await channel.stdout.next()).method, 'notifications/claude/channel')
    assert.equal(channel.diagnostics.filter((line) => line.includes('test watcher could not start')).length, 1)
    assert.equal(channel.diagnostics.filter((line) => line.includes('test watcher failed')).length, 1)
  } finally {
    await channel.close()
    await server.close()
    await second?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

it(
  'keeps MCP alive when the rendezvous directory is initially invalid and discovers servers after repair',
  { timeout: 30_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'hadley-channel-directory-'))
    const dir = rendezvousDirectory({ XDG_RUNTIME_DIR: root, LOCALAPPDATA: root })
    rmSync(dir, { recursive: true })
    writeFileSync(dir, 'not a directory')
    const channel = channelProcess(root)
    let server: Awaited<ReturnType<typeof fakeDevServer>> | undefined
    try {
      await channel.stderr.next((line) => line.includes('not a regular directory'))
      channel.rpc('ping', 1)
      assert.equal((await channel.stdout.next()).id, 1)
      rmSync(dir)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      server = await fakeDevServer(dir, root, 'https://repaired.example')
      const stream = await server.streams.next()
      stream.write(
        sse('message', { id: 'abcdefgh', text: 'Repaired', site: server.record.site, url: server.record.site + '/' }),
      )
      assert.equal((await channel.stdout.next()).method, 'notifications/claude/channel')
      assert.equal(channel.diagnostics.filter((line) => line.includes('not a regular directory')).length, 1)
    } finally {
      const closed = await Promise.allSettled([channel.close(), server?.close()])
      rmSync(root, { recursive: true, force: true })
      for (const result of closed) if (result.status === 'rejected') throw result.reason
    }
  },
)
