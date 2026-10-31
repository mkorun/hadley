import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { join } from 'node:path'
import {
  ORIGIN,
  admin,
  challenge,
  signature,
  solve,
  start,
  startFailing,
  submission,
  submit,
  type Service,
} from './harness.ts'

// The contract of the comments service (services/forms/CONTRACT.md), from outside: what the widget, the moderation
// CLI and the data files see. Runs against the service FORMS_SERVICE names (tests/harness.ts):
//   FORMS_SERVICE=<the binary> bun test services/forms/tests/

const RECORD_FIELDS = [
  'id',
  'submitted_at',
  'article_id',
  'language_version',
  'parent_comment_id',
  'name',
  'email',
  'text',
  'notify',
]

/** The status and the error message of a response with the body `{"error":"…"}` (C1). */
const failure = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error]

describe('C1, C2: routes and CORS', () => {
  let service: Service
  before(async () => (service = await start()))
  after(() => service.stop())

  it('answers a path no route has, and a method a route does not take, with 404 and a plain text', async () => {
    for (const response of [
      await fetch(`${service.url}/nothing`),
      await fetch(`${service.url}/api/comment/submit`),
      await fetch(`${service.url}/admin/comments`, { method: 'PUT' }),
    ]) {
      assert.equal(response.status, 404)
      assert.equal(await response.text(), '404 Not Found')
    }
  })

  it('names an allowed origin in Access-Control-Allow-Origin and answers an unlisted one without it', async () => {
    const allowed = await fetch(`${service.url}/api/comment/token`, {
      headers: { Origin: ORIGIN, 'X-Forwarded-For': '203.0.113.1' },
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN)
    assert.match(allowed.headers.get('vary') ?? '', /Origin/)
    const unlisted = await fetch(`${service.url}/api/comment/token`, {
      headers: { Origin: 'https://other.example', 'X-Forwarded-For': '203.0.113.2' },
    })
    assert.equal(unlisted.status, 200)
    assert.equal(unlisted.headers.get('access-control-allow-origin'), null)
  })

  it('answers a preflight with 204, its methods and headers, on any path', async () => {
    for (const path of ['/api/comment/submit', '/nothing']) {
      const response = await fetch(`${service.url}${path}`, {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
      })
      assert.equal(response.status, 204)
      assert.equal(await response.text(), '')
      assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN)
      const list = (name: string) => (response.headers.get(name) ?? '').split(',').map((item) => item.trim())
      assert.deepEqual(list('access-control-allow-methods'), ['GET', 'POST', 'DELETE'])
      assert.deepEqual(list('access-control-allow-headers'), ['Content-Type', 'Authorization'])
    }
  })
})

describe('C5, C6: the token route', () => {
  let service: Service
  before(async () => (service = await start({ PBKDF2_COST: '7', PBKDF2_KEY_PREFIX: 'a' })))
  after(() => service.stop())

  it('gives a PBKDF2/SHA-256 challenge with the configured cost and prefix, signed with the HMAC secret', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { parameters, signature: signed } = await challenge(service)
    assert.deepEqual(Object.keys(parameters).sort(), [
      'algorithm',
      'cost',
      'expiresAt',
      'keyLength',
      'keyPrefix',
      'nonce',
      'salt',
    ])
    assert.equal(parameters.algorithm, 'PBKDF2/SHA-256')
    assert.equal(parameters.cost, 7)
    assert.equal(parameters.keyPrefix, 'a')
    assert.equal(parameters.keyLength, 32)
    assert.match(parameters.nonce, /^[0-9a-f]{32}$/)
    assert.match(parameters.salt, /^[0-9a-f]{32}$/)
    assert.ok(Number.isInteger(parameters.expiresAt))
    assert.ok(Math.abs(parameters.expiresAt - (before + 900)) <= 5, 'expires TOKEN_TTL_SEC (900) from now')
    assert.equal(signed, signature(parameters))
  })

  it('gives each request a new nonce and salt', async () => {
    const [a, b] = [await challenge(service), await challenge(service)]
    assert.notEqual(a.parameters.nonce, b.parameters.nonce)
    assert.notEqual(a.parameters.salt, b.parameters.salt)
  })
})

describe('C4: rate limiting of the token route', () => {
  let service: Service
  before(async () => (service = await start({ RATE_LIMIT_MAX: '2' })))
  after(() => service.stop())

  const token = (from: string) => fetch(`${service.url}/api/comment/token`, { headers: { 'X-Forwarded-For': from } })

  it('counts an IPv4 address by its first three parts, and refuses past the maximum with 429', async () => {
    assert.equal((await token('192.0.2.1')).status, 200)
    assert.equal((await token('192.0.2.99, 10.0.0.1')).status, 200)
    assert.deepEqual(await failure(await token('192.0.2.50')), [429, 'Rate limit exceeded'])
    assert.equal((await token('192.0.3.1')).status, 200)
  })

  it('counts an IPv6 address by its first three groups, after expanding ::', async () => {
    assert.equal((await token('2001:db8::1')).status, 200)
    assert.equal((await token('2001:db8:0:5::1')).status, 200)
    assert.deepEqual(await failure(await token('2001:db8:0:7::9')), [429, 'Rate limit exceeded'])
  })

  it('does not count the submission route', async () => {
    for (let i = 0; i < 3; i++)
      assert.equal((await submit(service, 'nope', { 'X-Forwarded-For': '198.51.100.200' })).status, 400)
  })
})

describe('C7, C8, C9: submitting, and the admin routes', () => {
  let service: Service
  before(async () => (service = await start()))
  after(() => service.stop())

  const queue = () => readFileSync(join(service.dataDir, 'comments.json'), 'utf8')

  it('accepts a solved submission with 201 and {}, and appends it to the queue as one line of JSON', async () => {
    const response = await submit(service, await submission(service))
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), {})
    const lines = queue().split('\n')
    assert.equal(lines.length, 2, 'one record and the final LF')
    assert.equal(lines[1], '')
    const record = JSON.parse(lines[0]!)
    assert.deepEqual(Object.keys(record), RECORD_FIELDS)
    assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.match(record.submitted_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    assert.deepEqual(
      { ...record, id: undefined, submitted_at: undefined },
      {
        id: undefined,
        submitted_at: undefined,
        article_id: 'first-light',
        language_version: 'en',
        parent_comment_id: null,
        name: 'Nora Example',
        email: 'nora@example.net',
        text: 'Thank you for the clear explanation.',
        notify: true,
      },
    )
  })

  it('refuses a solution a second time', async () => {
    const body = await submission(service)
    assert.equal((await submit(service, body)).status, 201)
    assert.deepEqual(await failure(await submit(service, body)), [422, 'Challenge already used'])
  })

  it('cleans name, text and email, and stores notify only as literal true', async () => {
    const body = await submission(service, {
      name: '  Nö\u200Bra\u0007 ',
      text: 'line one\nline\u202Etwo',
      email: ' NORA@Example.NET ',
      notify: 'true',
    })
    assert.equal((await submit(service, body)).status, 201)
    const last = JSON.parse(queue().trim().split('\n').at(-1)!)
    assert.equal(last.name, 'Nöra')
    assert.equal(last.text, 'line onelinetwo')
    assert.equal(last.email, 'nora@example.net')
    assert.equal(last.notify, false)
  })

  it('freezes the queue for the admin, hands the frozen batch again until it is deleted, then the next', async () => {
    assert.deepEqual(await failure(await admin(service, 'GET', 'wrong')), [401, 'Unauthorized'])
    assert.deepEqual(await failure(await fetch(`${service.url}/admin/comments`, { method: 'DELETE' })), [
      401,
      'Unauthorized',
    ])
    const first = (await (await admin(service, 'GET')).json()) as { resumed: boolean; comments: { id: string }[] }
    assert.equal(first.resumed, false)
    assert.ok(first.comments.length >= 3)
    assert.deepEqual(Object.keys(first.comments[0]!), RECORD_FIELDS)
    assert.equal((await submit(service, await submission(service, { text: 'after the freeze' }))).status, 201)
    const again = (await (await admin(service, 'GET')).json()) as typeof first
    assert.equal(again.resumed, true)
    assert.deepEqual(again, { ...first, resumed: true })
    const deleted = await admin(service, 'DELETE')
    assert.equal(deleted.status, 204)
    assert.equal(await deleted.text(), '')
    const next = (await (await admin(service, 'GET')).json()) as { resumed: boolean; comments: { text: string }[] }
    assert.equal(next.resumed, false)
    assert.deepEqual(
      next.comments.map((comment) => comment.text),
      ['after the freeze'],
    )
    assert.equal((await admin(service, 'DELETE')).status, 204)
    assert.deepEqual(await (await admin(service, 'GET')).json(), { resumed: false, comments: [] })
    assert.equal((await admin(service, 'DELETE')).status, 204, 'deleting nothing succeeds')
  })
})

describe('C7: the order of the checks of a submission', () => {
  let service: Service
  before(async () => (service = await start()))
  after(() => service.stop())

  // fields that pass every check before the proof of work (stage 16)
  const valid = {
    altcha: {},
    article_id: 'a',
    language_version: 'de',
    name: 'N',
    text: 'T',
  }
  const cases: [string, unknown, number, string][] = [
    ['no JSON', 'nope', 400, 'Invalid JSON'],
    ['no altcha', { ...valid, altcha: undefined }, 400, 'Missing or invalid fields'],
    ['an empty article_id', { ...valid, article_id: '' }, 400, 'Missing or invalid fields'],
    ['a parent that is a number', { ...valid, parent_comment_id: 5 }, 400, 'Missing or invalid fields'],
    ['an article_id with a slash', { ...valid, article_id: 'a/b' }, 400, 'Invalid article_id'],
    ['a language that is no code', { ...valid, language_version: 'english' }, 400, 'Invalid language_version'],
    ['a parent that is no UUID', { ...valid, parent_comment_id: 'x' }, 400, 'Invalid parent_comment_id'],
    ['a name that is empty once cleaned', { ...valid, name: '\u200B ' }, 400, 'Missing or invalid fields'],
    ['a name of 101 characters', { ...valid, name: 'n'.repeat(101), email: 'x' }, 400, 'name too long'],
    ['a text of spaces', { ...valid, text: '   ' }, 400, 'Missing or invalid fields'],
    ['a text of 10001 characters', { ...valid, text: 't'.repeat(10_001) }, 400, 'text too long'],
    ['notify without email', { ...valid, notify: true }, 400, 'email required when notify is true'],
    ['an email of 255 characters', { ...valid, email: `${'e'.repeat(64)}@${'d'.repeat(190)}` }, 400, 'email too long'],
    ['an email without @', { ...valid, email: 'no-at' }, 400, 'Invalid email'],
    ['an empty altcha', valid, 422, 'Invalid altcha payload'],
    [
      'a challenge without nonce',
      { ...valid, altcha: { challenge: { parameters: {} }, solution: {} } },
      422,
      'Invalid challenge',
    ],
  ]
  for (const [what, body, status, message] of cases)
    it(`answers ${what} with ${status} "${message}"`, async () => {
      assert.deepEqual(await failure(await submit(service, body)), [status, message])
    })

  it('refuses a body over 16384 bytes with 413 before reading it, with the CORS headers the widget needs', async () => {
    const response = await submit(service, { ...valid, text: 't'.repeat(16_400) }, { Origin: ORIGIN })
    assert.equal(response.status, 413)
    assert.equal(await response.text(), 'Payload Too Large')
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN)
  })

  it('refuses a solution that does not fit its challenge, and a challenge signed with another secret', async () => {
    const body = await submission(service)
    const wrongKey = { ...body.altcha.solution, derivedKey: '0'.repeat(64) }
    assert.deepEqual(
      await failure(await submit(service, { ...body, altcha: { ...body.altcha, solution: wrongKey } })),
      [422, 'Invalid solution'],
    )
    const forged = await challenge(service)
    const resigned = { ...forged, signature: signature(forged.parameters, 'another secret') }
    assert.deepEqual(
      await failure(
        await submit(service, {
          ...(await submission(service)),
          altcha: { challenge: resigned, solution: solve(resigned) },
        }),
      ),
      [422, 'Invalid solution'],
    )
  })
})

describe('C7: an expired challenge, and a full queue', () => {
  it('refuses a solution once its challenge has expired', async () => {
    const service = await start({ TOKEN_TTL_SEC: '1' })
    try {
      const body = await submission(service)
      await new Promise((wait) => setTimeout(wait, 2_100))
      assert.deepEqual(await failure(await submit(service, body)), [422, 'Invalid solution'])
    } finally {
      await service.stop()
    }
  })

  it('refuses a submission with 503 once the queue holds MAX_QUEUE_ENTRIES records', async () => {
    const service = await start({ MAX_QUEUE_ENTRIES: '1' })
    try {
      assert.equal((await submit(service, await submission(service))).status, 201)
      assert.deepEqual(await failure(await submit(service, await submission(service))), [503, 'Queue full'])
    } finally {
      await service.stop()
    }
  })
})

describe('C3: configuration the service refuses', () => {
  const refused: [string, Record<string, string | undefined>, RegExp][] = [
    ['no origin', { CORS_ORIGINS: undefined, DATA_DIR: '/tmp' }, /No CORS origins configured/],
    ['no DATA_DIR', { DATA_DIR: undefined }, /Missing required env variable: DATA_DIR/],
    ['no ADMIN_TOKEN', { DATA_DIR: '/tmp', ADMIN_TOKEN: undefined }, /Missing required env variable: ADMIN_TOKEN/],
    ['a PORT that is no number', { DATA_DIR: '/tmp', PORT: 'abc' }, /Env variable PORT must be a number, got: abc/],
  ]
  for (const [what, env, message] of refused)
    it(`stops with ${what}`, async () => {
      const { code, output } = await startFailing(env)
      assert.notEqual(code, 0)
      assert.match(output, message)
    })
})

describe('C12: notification', () => {
  it('posts the name, the article and a preview of at most 120 characters to NTFY_URL with its token', async () => {
    const received: { headers: IncomingMessage['headers']; body: string }[] = []
    const ntfy = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        received.push({ headers: request.headers, body })
        response.end()
      })
    })
    await new Promise<void>((done) => ntfy.listen(0, '127.0.0.1', () => done()))
    const { port } = ntfy.address() as { port: number }
    const service = await start({ NTFY_URL: `http://127.0.0.1:${port}/topic`, NTFY_TOKEN: 'ntfy-token' })
    try {
      const text = 'x'.repeat(130)
      assert.equal((await submit(service, await submission(service, { text }))).status, 201)
      const deadline = Date.now() + 5_000
      while (received.length === 0 && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 50))
      assert.equal(received.length, 1)
      const [{ headers, body }] = received as [(typeof received)[0]]
      assert.equal(headers.authorization, 'Bearer ntfy-token')
      assert.equal(headers['x-title'], 'Neuer Kommentar')
      assert.equal(headers['x-tags'], 'speech_balloon')
      assert.match(headers['content-type'] ?? '', /^text\/plain/)
      assert.equal(body, `Nora Example → first-light\n${'x'.repeat(120)}…`)
    } finally {
      await service.stop()
      ntfy.close()
    }
  })
})
