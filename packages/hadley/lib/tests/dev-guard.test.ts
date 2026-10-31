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
        { method: 'GET', url: '/__hadley/editor.js', headers: { host: 'localhost:8000' } },
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
})
