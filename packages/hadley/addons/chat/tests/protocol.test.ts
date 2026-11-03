import assert from 'node:assert/strict'
import { it } from 'node:test'
import { resolve } from 'node:path'
import { chatInput, message, newId, parseJson, permission, reply, sse, sseParser, verdict } from '../protocol.ts'

it('validates every channel message shape and refuses missing or unknown fields', () => {
  const data = {
    id: newId(),
    text: 'Hello',
    root: resolve('site'),
    site: 'https://site.example',
    url: 'https://site.example/page/',
  }
  assert.deepEqual(message(data), data)
  assert.deepEqual(reply({ id: newId(), to: data.id, text: 'Answer' }).to, data.id)
  assert.deepEqual(verdict({ request_id: 'abcde', allow: false }), { request_id: 'abcde', allow: false })
  assert.deepEqual(
    permission({ request_id: 'abcde', tool: 'Read', description: 'Read source', preview: '' }).preview,
    '',
  )
  for (const invalid of [
    null,
    [],
    { ...data, id: 'old' },
    { ...data, root: undefined },
    { ...data, root: 'relative/site' },
    { ...data, root: '' },
    { ...data, root: 123 },
    { ...data, file: '../secret' },
    { ...data, lines: '5-1' },
    { ...data, site: 'file:///' },
    { ...data, url: 'https://other.example/' },
    { ...data, extra: true },
  ])
    assert.throws(() => message(invalid))
  for (const request_id of ['abc1e', 'abc le', 'abcle', 'ABCde', 'abcde\n'])
    assert.throws(() => verdict({ request_id, allow: true }))
  assert.throws(() => verdict({ request_id: 'abcde', allow: 'yes' }), /allow/)
  assert.throws(() => permission({ request_id: 'abcde', tool: 'Read', description: 'Read' }), /preview/)
  for (const page of ['https://evil.example', '//evil.example/', '/\\evil', '/\n'])
    assert.throws(() => chatInput({ page, text: 'hello' }), /page/)
  assert.throws(() => chatInput({ page: '/', text: 'hello', file: '/secret' }), /unknown field/)
  assert.equal(new Set(Array.from({ length: 1000 }, newId)).size, 1000)
})

it('parses split and coalesced SSE frames, without accepting another format', () => {
  const received: unknown[] = []
  const parse = sseParser((event, data) => received.push({ event, data }))
  const frame = ': connected\n\n' + sse('verdict', { request_id: 'abcde', allow: true })
  for (const char of frame) parse(char)
  parse(sse('reply', { text: 'one' }) + sse('reply', { text: 'two' }))
  assert.equal(received.length, 3)
  assert.throws(() => parse('data: {}\n\n'), /invalid hadley SSE/)
})

it('reports malformed JSON without quoting private input', () => {
  assert.throws(
    () => parseJson('{"text":"private-message"', 'message'),
    (error: Error) => {
      assert.equal(error.message, 'message: invalid JSON')
      return true
    },
  )
})

it('validates rewrite fields once for browser inputs and channel messages', () => {
  const base = { page: '/page/', block: 'block', action: 'rewrite-block', direction: 'clearer', draft: 'One 🦊. Two.' }
  const envelope = {
    id: 'abcdefgh',
    text: 'Rewrite',
    root: resolve('site'),
    site: 'https://site.example',
    url: 'https://site.example/page/',
  }
  const validate = (value: unknown) => {
    const input = chatInput(value)
    const { page: _page, ...fields } = input
    return message({ ...envelope, ...fields })
  }
  assert.equal(validate(base).action, 'rewrite-block')
  for (const key of ['block', 'direction', 'draft']) {
    const missing: Record<string, unknown> = { ...base }
    delete missing[key]
    assert.throws(
      () => validate(missing),
      (error: Error) => error.message.includes(key),
    )
  }
  for (const extra of [
    { action: 'rewrite' },
    { direction: 'unknown' },
    { direction: ['clearer'] },
    { draft: null },
    { instruction: 'Do this' },
    { selection: { start: 0, end: 1 } },
    { direction: 'custom' },
    { direction: 'custom', instruction: '' },
    { direction: 'custom', instruction: 'x'.repeat(501) },
  ])
    assert.throws(() => validate({ ...base, ...extra }))
  assert.equal(validate({ ...base, direction: 'custom', instruction: 'x'.repeat(500) }).action, 'rewrite-block')
  const selected = { ...base, action: 'rewrite-selection', selection: { start: 4, end: 6 } }
  assert.equal(validate(selected).action, 'rewrite-selection')
  for (const selection of [
    undefined,
    null,
    {},
    { start: 0 },
    { end: 1 },
    { start: -1, end: 2 },
    { start: 0, end: 50 },
    { start: 2, end: 2 },
    { start: 3, end: 1 },
    { start: 0.5, end: 1 },
    { start: 0, end: 1.5 },
    { start: '0', end: 1 },
    { start: 0, end: 1, unknown: true },
  ]) {
    assert.throws(() => validate({ ...selected, selection }), /selection/)
  }
  for (const key of ['direction', 'instruction', 'draft', 'selection']) {
    assert.throws(() => chatInput({ page: '/', text: 'Hello', [key]: base.draft }), /requires an action/)
  }
})

it('preserves timestamped SSE payloads and refuses malformed event times', () => {
  const received: unknown[] = []
  const parse = sseParser((event, data) => received.push({ event, data }))
  parse(sse('delivered', { id: 'abcdefgh' }, 1234567890))
  assert.deepEqual(received, [{ event: 'delivered', data: { id: 'abcdefgh' } }])
  for (const id of ['invalid', '-1', '1.5', '9007199254740992']) {
    assert.throws(() => sseParser(() => {})(`id: ${id}\nevent: delivered\ndata: {}\n\n`), /SSE time/)
  }
})
