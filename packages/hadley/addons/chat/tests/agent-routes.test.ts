import assert from 'node:assert/strict'
import { afterEach, beforeEach, it } from 'node:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devServer, events, post } from './support.ts'

// the panel starts and stops an agent in the background (agents.ts); a dev server has one agent, this or a channel
const skip = process.platform === 'win32' && 'the stand-ins start through a shell script'
let dir: string
let previous: string | undefined
let previousLocal: string | undefined
let dev: Awaited<ReturnType<typeof devServer>>
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-chat-agent-routes-'))
  previousLocal = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = dir
  previous = process.env.XDG_RUNTIME_DIR
  process.env.XDG_RUNTIME_DIR = dir
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const program = join(bin, 'claude')
  writeFileSync(
    program,
    `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dirname, 'fake-agents', 'claude.mjs')}" "$@"\n`,
  )
  chmodSync(program, 0o755)
  mkdirSync(join(dir, 'site'))
  dev = await devServer(join(dir, 'site'), { claude: program })
})
afterEach(async () => {
  await dev.close()
  if (previous === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = previous
  if (previousLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previousLocal
  rmSync(dir, { recursive: true, force: true })
})

it('starts an agent for a browser with the key, answers through it, and stops it', { skip }, async () => {
  const browser = await events(dev.origin, '/__hadley/chat/events')
  try {
    assert.deepEqual((await browser.inbox.next((e) => e.event === 'status')).data, {
      connected: false,
      available: ['claude'],
    })
    // only from this machine and this origin, with the key, and only an agent there is
    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: 'claude' }, {})).status, 403)
    assert.equal(
      (await post(dev.origin, '/__hadley/chat/agent', { run: 'claude' }, { Origin: dev.origin })).status,
      401,
    )
    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: 'codex' })).status, 404)
    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: '/bin/sh' })).status, 400)
    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: 'claude', more: 1 })).status, 400)

    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: 'claude', fresh: true })).status, 200)
    assert.deepEqual((await browser.inbox.next((e) => e.event === 'status')).data, {
      connected: true,
      agent: 'Claude Code',
      background: 'claude',
      available: ['claude'],
    })
    // a channel cannot join the agent that runs
    const channel = await fetch(dev.origin + '/__hadley/channel/events', { headers: { 'X-Hadley-Token': dev.token } })
    assert.equal(channel.status, 409)

    const sent = await post(dev.origin, '/__hadley/chat?lang=de', { text: 'hello', page: '/' })
    assert.equal(sent.status, 200)
    const { id } = (await sent.json()) as { id: string }
    assert.deepEqual((await browser.inbox.next((e) => e.event === 'delivered')).data, { id })
    const reply = (await browser.inbox.next((e) => e.event === 'reply')).data as { to: string; text: string }
    assert.equal(reply.to, id)
    assert.equal(reply.text, 'echo: hello')

    // a permission goes to the panel, and the verdict back to the agent
    await post(dev.origin, '/__hadley/chat', { text: 'TOOL', page: '/' })
    const asked = (await browser.inbox.next((e) => e.event === 'permission')).data as { request_id: string }
    assert.equal(
      (await post(dev.origin, '/__hadley/chat/verdict', { request_id: asked.request_id, allow: false })).status,
      200,
    )
    const denied = (await browser.inbox.next((e) => e.event === 'reply')).data as { text: string }
    assert.match(denied.text, /^denied/)
    assert.equal(
      (await post(dev.origin, '/__hadley/chat/verdict', { request_id: asked.request_id, allow: true })).status,
      409,
    )

    assert.equal((await post(dev.origin, '/__hadley/chat/agent', { run: null })).status, 200)
    const stopped = (e: { event: string; data: unknown }) =>
      e.event === 'notice' && (e.data as { kind: string }).kind === 'stopped'
    assert.deepEqual((await browser.inbox.next(stopped)).data, {
      kind: 'stopped',
      agent: 'Claude Code',
    })
    assert.deepEqual((await browser.inbox.next((e) => e.event === 'status')).data, {
      connected: false,
      available: ['claude'],
    })
    assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' })).status, 503)
  } finally {
    browser.close()
  }
})
