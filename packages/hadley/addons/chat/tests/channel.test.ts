import assert from 'node:assert/strict'
import { it } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import http, { type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createRendezvous, rendezvousDirectory } from '../rendezvous.ts'
import { sse } from '../protocol.ts'
import { Inbox } from './support.ts'

async function fakeDevServer(dir: string, root: string, site: string) {
  const streams = new Inbox<ServerResponse>()
  const posts = new Inbox<unknown>()
  let token = ''
  const responses = new Set<ServerResponse>()
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['x-hadley-token'], token)
    assert.equal(req.headers.origin, undefined)
    if (req.url === '/__hadley/channel/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': connected\n\n')
      streams.push(res)
      responses.add(res)
      res.once('close', () => responses.delete(res))
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
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  const rendezvous = createRendezvous(port, site, root, dir)
  token = rendezvous.record.token
  return {
    streams,
    posts,
    async close() {
      rendezvous.close()
      for (const res of responses) res.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
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
      const permission = { request_id: 'abcde', tool: 'Read', description: 'Read source', preview: '{}' }
      rpc('notifications/claude/channel/permission_request', undefined, permission)
      for (const fake of [first, second]) assert.deepEqual(await fake.posts.next(), permission)
      stream.write(sse('verdict', { request_id: 'abcde', allow: true }))
      assert.deepEqual(await stdout.next(), {
        jsonrpc: '2.0',
        method: 'notifications/claude/channel/permission',
        params: { request_id: 'abcde', behavior: 'allow' },
      })
      rpc('notifications/claude/channel/permission_request', undefined, { ...permission, request_id: 'bcdef' })
      for (const fake of [first, second]) await fake.posts.next()
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
