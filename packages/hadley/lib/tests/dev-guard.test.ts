import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { refusal } from '../dev-guard.ts'

// What the dev server refuses before the editor, the comments proxy or Vite see a request (lib/dev-guard.ts).
// review 2026-10-26 (dev server): it served files above the output directory, proxied /admin/../x as /x, answered
// any host over HTTPS; and the editor took writes from another machine and, by a Content-Type, from another site

const allowed = { origin: 'http://localhost:8000', hosts: ['workstation.fritz.box', '.trycloudflare.com'] }
const get = (url: string, host = 'localhost:8000') =>
  refusal({ method: 'GET', url, headers: { host } }, '127.0.0.1', allowed)

describe('the dev server', () => {
  it('refuses a path with . or .. segments, however encoded, before the proxy reads it', () => {
    for (const url of [
      '/../../node_modules/x',
      '/admin/../private',
      '/admin/%2e%2e/private',
      '/api/comment/..%2fother',
      '/a/./b',
      '/a\\..\\b',
      '/%00',
      '/%E0%A4%A',
    ])
      assert.equal(get(url)?.status, 400, url)
    for (const url of ['/', '/autor/', '/llms.txt', '/a..b/', '/caf%C3%A9/', '/admin/comments?x=..'])
      assert.equal(get(url), undefined, url)
  })

  it('answers localhost, addresses and the names it is given, over HTTP/1 and HTTP/2', () => {
    for (const host of [
      'localhost:8000',
      '127.0.0.1:8000',
      '[::1]:8000',
      '192.168.1.20:8000',
      'workstation.fritz.box:8000',
      'x.trycloudflare.com',
    ])
      assert.equal(get('/', host), undefined, host)
    for (const host of ['evil.example', 'fritz.box', 'trycloudflare.com.evil', ''])
      assert.equal(get('/', host)?.status, 403, host)
    assert.equal(
      refusal({ method: 'GET', url: '/', headers: { ':authority': 'localhost:8000' } }, '::1', allowed),
      undefined,
    )
  })

  it('takes an editor write only from this machine and the page own origin', () => {
    const post = (origin: string | undefined, address: string) =>
      refusal(
        { method: 'POST', url: '/__hadley/patch', headers: { host: 'localhost:8000', ...(origin ? { origin } : {}) } },
        address,
        allowed,
      )
    assert.equal(post('http://localhost:8000', '127.0.0.1'), undefined)
    assert.equal(post('http://localhost:8000', '::ffff:127.0.0.1'), undefined)
    assert.equal(post('http://localhost:8000', '192.168.1.30')?.status, 403)
    assert.equal(post('https://evil.example', '127.0.0.1')?.status, 403)
    assert.equal(post(undefined, '127.0.0.1')?.status, 403)
  })

  // review 2026-10-29: only writes were held to this machine, so another one on the network read a page's Markdown
  it("gives a block's source only to this machine, and never to another origin", () => {
    const read = (address: string, headers: Record<string, string> = {}) =>
      refusal(
        { method: 'GET', url: '/__hadley/block/b-1', headers: { host: 'localhost:8000', ...headers } },
        address,
        allowed,
      )
    assert.equal(read('127.0.0.1'), undefined)
    assert.equal(read('::1', { origin: 'http://localhost:8000', 'sec-fetch-site': 'same-origin' }), undefined)
    assert.equal(read('192.168.1.30')?.status, 403)
    assert.equal(read('127.0.0.1', { origin: 'https://evil.example' })?.status, 403)
    assert.equal(read('127.0.0.1', { 'sec-fetch-site': 'cross-site' })?.status, 403)
    assert.equal(read('127.0.0.1', { 'sec-fetch-site': 'same-site' })?.status, 403)
    // the editor's script and styles are no source of a page
    assert.equal(
      refusal(
        { method: 'GET', url: '/__hadley/editor/main.ts', headers: { host: 'localhost:8000' } },
        '192.168.1.30',
        allowed,
      ),
      undefined,
    )
  })
})

// review 2026-10-31 (before going public): any page could call Vite's editor opener, and a tunnel, which arrives from
// this machine, reached the block editor
describe('what the dev server keeps to itself', () => {
  it("refuses Vite's /__open-in-editor to everyone", () => {
    assert.equal(get('/__open-in-editor?file=/etc/hostname')?.status, 404)
    assert.equal(get('http://localhost:8000/__open-in-editor?file=/etc/hostname')?.status, 400)
  })

  it('answers the editor under its own host alone', () => {
    const headers = (host: string) => ({ host, origin: allowed.origin })
    const write = (host: string) =>
      refusal({ method: 'POST', url: '/__hadley/patch', headers: headers(host) }, '127.0.0.1', allowed)
    assert.equal(write('localhost:8000'), undefined)
    assert.equal(write('x.trycloudflare.com')?.status, 403)
    assert.equal(get('/__hadley/block/1', 'x.trycloudflare.com')?.status, 403)
  })

  // review 2026-11-06: a tunnel that gives the dev server's own host passed for this machine
  it('answers no request a proxy forwarded, even under its own host and origin', () => {
    const local = { host: 'localhost:8000', origin: allowed.origin }
    for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'via', 'cf-connecting-ip'])
      for (const [method, url] of [
        ['POST', '/__hadley/upload'],
        ['POST', '/__hadley/patch'],
        ['GET', '/__hadley/block/1'],
        ['GET', '/__hadley/files/1'],
        ['GET', '/__hadley/chat/events'],
      ] as const) {
        const headers = { ...local, [header]: '203.0.113.7' }
        assert.equal(refusal({ method, url, headers }, '127.0.0.1', allowed)?.status, 403, `${header} ${url}`)
      }
    // the channel of a local process, with its token and without an Origin, neither
    const channel = { ...allowed, channelToken: 'token' }
    const token = { host: 'localhost:8000', 'x-hadley-token': 'token' }
    const ask = (headers: Record<string, string>) =>
      refusal({ method: 'GET', url: '/__hadley/channel/events', headers }, '127.0.0.1', channel)
    assert.equal(ask(token), undefined)
    assert.equal(ask({ ...token, 'x-forwarded-for': '203.0.113.7' })?.status, 403)
    // the site's own pages it still shows through a tunnel
    assert.equal(
      refusal({ method: 'GET', url: '/', headers: { ...local, via: '1.1 tunnel' } }, '127.0.0.1', allowed),
      undefined,
    )
  })
})

it('guards chat reads and writes exactly as editor source and writes', () => {
  for (const [method, url] of [
    ['GET', '/__hadley/chat/events'],
    ['POST', '/__hadley/chat'],
    ['POST', '/__hadley/chat/verdict'],
  ]) {
    const headers = { host: 'localhost:8000', origin: allowed.origin }
    assert.equal(refusal({ method, url, headers }, '127.0.0.1', allowed), undefined)
    for (const remote of ['192.168.1.3', '::ffff:192.168.1.3'])
      assert.equal(refusal({ method, url, headers }, remote, allowed)?.status, 403)
    for (const foreign of [
      { ...headers, origin: 'https://evil.example' },
      { ...headers, host: 'x.trycloudflare.com' },
    ])
      assert.equal(refusal({ method, url, headers: foreign }, '127.0.0.1', allowed)?.status, 403)
  }
})

it('requires a local channel with a token, without any Origin, independently of browser guards', () => {
  const auth = { ...allowed, channelToken: 'a'.repeat(64) }
  for (const [method, url] of [
    ['GET', '/__hadley/channel/events'],
    ['POST', '/__hadley/channel'],
  ]) {
    const headers = { host: 'localhost:8000', 'x-hadley-token': auth.channelToken }
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      assert.equal(refusal({ method, url, headers }, remote, auth), undefined)
    assert.equal(refusal({ method, url, headers }, '192.168.1.2', auth)?.status, 403)
    assert.equal(refusal({ method, url, headers }, '127.0.0.1', allowed)?.status, 403)
    for (const extra of [
      { 'x-hadley-token': 'bad' },
      { 'x-hadley-token': 'b'.repeat(64) },
      { origin: allowed.origin },
      { origin: '' },
      { 'x-hadley-token': ['a'.repeat(64)] },
    ])
      assert.equal(refusal({ method, url, headers: { ...headers, ...extra } }, '127.0.0.1', auth)?.status, 403)
  }
})
