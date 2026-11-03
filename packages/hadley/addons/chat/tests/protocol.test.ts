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
