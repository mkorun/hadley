import assert from 'node:assert/strict'
import { afterEach, beforeEach, it } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { blockIdMap } from '../../editor/plugin.ts'
import { devServer, events, post } from './support.ts'
import { newId } from '../protocol.ts'
import { directories } from '../rendezvous.ts'

let dir: string
let previous: string | undefined
let previousLocal: string | undefined
let dev: Awaited<ReturnType<typeof devServer>>
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-chat-plugin-'))
  previousLocal = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = dir
  previous = process.env.XDG_RUNTIME_DIR
  process.env.XDG_RUNTIME_DIR = dir
  dev = await devServer(dir)
})
afterEach(async () => {
  await dev.close()
  if (previous === undefined) delete process.env.XDG_RUNTIME_DIR
  else process.env.XDG_RUNTIME_DIR = previous
  if (previousLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = previousLocal
  blockIdMap.clear()
  rmSync(dir, { recursive: true, force: true })
})

it('guards every HTTP endpoint, and returns 503 without a channel', async () => {
  for (const path of ['/__hadley/chat', '/__hadley/chat/verdict']) {
    assert.equal((await post(dev.origin, path, {}, {})).status, 403)
    assert.equal((await post(dev.origin, path, {}, { Origin: 'https://evil.example' })).status, 403)
  }
  assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' })).status, 503)
  assert.equal(
    (await fetch(dev.origin + '/__hadley/chat/events', { headers: { Origin: 'https://evil.example' } })).status,
    403,
  )
  for (const path of ['/__hadley/channel', '/__hadley/channel/events']) {
    const method = path.endsWith('events') ? 'GET' : 'POST'
    for (const headers of [{}, { 'X-Hadley-Token': 'wrong' }, { 'X-Hadley-Token': dev.token, Origin: dev.origin }])
      assert.equal((await fetch(dev.origin + path, { method, headers })).status, 403)
  }
  const record = JSON.parse(readFileSync(join(directories()[directories().length - 1], `${dev.port}.json`), 'utf8'))
  assert.equal(record.token, dev.token)
})

it('resolves blocks on the server, refuses stale sources and browser-supplied paths, and replaces an SSE channel', async () => {
  const channel = await events(dev.origin, '/__hadley/channel/events', { 'X-Hadley-Token': dev.token })
  try {
    const source = '# Page\r\n\r\nOne.\r\nTwo.\r\n'
    const file = join(dir, 'page.md')
    writeFileSync(file, source)
    blockIdMap.set('block', {
      filePath: file,
      start: 8,
      end: 18,
      fileHashAtRender: createHash('sha256').update(source).digest('hex'),
    })
    const response = await post(dev.origin, '/__hadley/chat', { text: 'Explain', page: '/page/', block: 'block' })
    assert.equal(response.status, 200)
    const { id } = (await response.json()) as { id: string }
    assert.deepEqual((await channel.inbox.next()).data, {
      id,
      text: 'Explain',
      site: 'https://site.example',
      url: 'https://site.example/page/',
      block: 'block',
      file: 'page.md',
      lines: '3-4',
    })
    const browser = await events(dev.origin, '/__hadley/chat/events')
    try {
      const snapshot = await browser.inbox.next()
      assert.equal(snapshot.event, 'history')
      const entries = snapshot.data as { event: string; data: { id: string } }[]
      assert.equal(entries.find((entry) => entry.event === 'message')?.data.id, id)
    } finally {
      browser.close()
    }
    assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/', file: '/secret' })).status, 400)
    assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/', block: 'missing' })).status, 404)
    writeFileSync(file, source + 'Changed')
    assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/', block: 'block' })).status, 409)
    const ended = once(channel.response, 'end')
    const second = await events(dev.origin, '/__hadley/channel/events', { 'X-Hadley-Token': dev.token })
    await ended
    try {
      assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'next', page: '/' })).status, 200)
      assert.equal((await second.inbox.next()).event, 'message')
    } finally {
      second.close()
    }
  } finally {
    channel.close()
  }
})

it('relays replies, validates open permission verdicts, and replays only the last 200 history entries', async () => {
  const channel = await events(dev.origin, '/__hadley/channel/events', { 'X-Hadley-Token': dev.token })
  const browser = await events(dev.origin, '/__hadley/chat/events')
  try {
    assert.equal((await browser.inbox.next()).event, 'history')
    assert.equal((await browser.inbox.next()).event, 'status')
    const headers = { 'X-Hadley-Token': dev.token }
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'abcde', allow: true })).status, 409)
    const permission = { request_id: 'abcde', tool: 'Read', description: 'Read source', preview: '{}' }
    assert.equal((await post(dev.origin, '/__hadley/channel', permission, headers)).status, 200)
    assert.deepEqual((await browser.inbox.next((entry) => entry.event === 'permission')).data, permission)
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'abcde', allow: 'yes' })).status, 400)
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'abcde', allow: false })).status, 200)
    assert.deepEqual(await channel.inbox.next(), { event: 'verdict', data: { request_id: 'abcde', allow: false } })
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'abcde', allow: true })).status, 409)
    assert.equal(
      (await post(dev.origin, '/__hadley/channel', { id: newId(), to: 'aaaaaaaa', text: 'bad' }, headers)).status,
      409,
    )
    const duplicate = { id: newId(), text: 'Only once' }
    assert.equal((await post(dev.origin, '/__hadley/channel', duplicate, headers)).status, 200)
    assert.equal((await post(dev.origin, '/__hadley/channel', duplicate, headers)).status, 409)
    for (let i = 0; i < 205; i++) {
      assert.equal((await post(dev.origin, '/__hadley/channel', { id: newId(), text: String(i) }, headers)).status, 200)
    }
    const replay = await events(dev.origin, '/__hadley/chat/events')
    try {
      const snapshot = await replay.inbox.next()
      assert.equal(snapshot.event, 'history')
      const entries = snapshot.data as { event: string; data: { text: string } }[]
      assert.equal(entries.length, 200)
      for (let i = 0; i < entries.length; i++) {
        assert.equal(entries[i].event, 'reply')
        assert.equal(entries[i].data.text, String(i + 5))
      }
      assert.deepEqual(await replay.inbox.next(), { event: 'status', data: { connected: true } })
      const disconnected = once(channel.response, 'close')
      channel.close()
      await disconnected
      assert.deepEqual((await replay.inbox.next()).data, { connected: false })
      assert.equal((await post(dev.origin, '/__hadley/chat', { text: 'hello', page: '/' })).status, 503)
    } finally {
      replay.close()
    }
  } finally {
    channel.close()
    browser.close()
  }
})

it('marks historical permissions as closed after a verdict or channel replacement', async () => {
  const channel = await events(dev.origin, '/__hadley/channel/events', { 'X-Hadley-Token': dev.token })
  let replacement: Awaited<ReturnType<typeof events>> | undefined
  const prompt = { request_id: 'abcde', tool: 'Read', description: 'Read source', preview: '{}' }
  const snapshot = async (id: string) => {
    const browser = await events(dev.origin, '/__hadley/chat/events')
    try {
      const { data } = await browser.inbox.next()
      return (data as { event: string; data: { request_id: string }; open?: boolean }[]).find(
        (entry) => entry.event === 'permission' && entry.data.request_id === id,
      )?.open
    } finally {
      browser.close()
    }
  }
  try {
    assert.equal((await post(dev.origin, '/__hadley/channel', prompt, { 'X-Hadley-Token': dev.token })).status, 200)
    assert.equal(await snapshot('abcde'), true)
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'abcde', allow: true })).status, 200)
    assert.equal(await snapshot('abcde'), false)
    assert.equal(
      (await post(dev.origin, '/__hadley/channel', { ...prompt, request_id: 'bcdef' }, { 'X-Hadley-Token': dev.token }))
        .status,
      200,
    )
    const ended = once(channel.response, 'end')
    replacement = await events(dev.origin, '/__hadley/channel/events', { 'X-Hadley-Token': dev.token })
    await ended
    assert.equal(await snapshot('bcdef'), false)
    assert.equal((await post(dev.origin, '/__hadley/chat/verdict', { request_id: 'bcdef', allow: true })).status, 409)
  } finally {
    channel.close()
    replacement?.close()
  }
})
