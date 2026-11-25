import { afterEach, beforeEach, describe, it, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from '../../../index.ts'
import { quietly } from '../../../lib/tests/helpers.ts'
import { runCommentsCli } from '../index.ts'
import type { QueueEntry } from '../screen.ts'

// What a build with comments on checks before `hadley comments` meets it (docs/comments.md), and what a run of
// `hadley comments` leaves when the theme cannot write an article's comments.

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-comment-validation-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function file(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), text)
}
const read = (path: string) => readFile(join(dir, path), 'utf8')

const config = (language: string, url: string | null = 'https://comments.example.org') =>
  `site:\n  origin: https://example.org\n  default:\n    language: ${language}\n    title: Test\n` +
  `comments:\n  enabled: true\n${url === null ? '' : `  url: ${url}\n`}  archive: archive\nstrictUndefined: true\n`

// the heading as hems and punch write it, and as they wrote it before the plural filter
const HEADING =
  '{@const count = comments | length}' +
  '{#if count > 0}<h2>{ count } { count | plural(language, t.comments.heading) }</h2>{/if}'
const OLD_HEADING =
  '{#if comments.length > 0}<h2>{ comments | length } ' +
  '{#if comments.length === 1}{ t.comments.headingSingular }{:else}{ t.comments.headingPlural }{/if}</h2>{/if}'
const COMMENTS = '{#each comments as comment}<p id="c-{ comment.id }">{ comment.name }</p>{/each}'
const ENGLISH = 'comments:\n  heading:\n    one: comment\n    other: comments\n'
const POLISH = 'comments:\n  heading:\n    one: komentarz\n    many: komentarzy\n    other: komentarza\n'

/** A site in one language with a home page and a theme of its own: its comments template and its texts, if any. */
async function site(language: string, template: string, texts: string | undefined): Promise<void> {
  await file('config.lima', config(language))
  await file('content/pages/[home]/home.md', '---\ntitle: Home\n---\n')
  await file(
    'theme/templates/page.chase',
    '<!doctype html><title>{ meta.title }</title>' +
      '{#if site.comments}<p data-service-url="{ site.comments.url }"></p>{/if}',
  )
  await file('theme/templates/partials/comments.sort', template)
  if (texts !== undefined) await file(`theme/i18n/${language}.lima`, texts)
}
const builds = async () => {
  await quietly(() => build(dir, 'dev'))
  await quietly(() => build(dir, 'publish'))
}
const stops = (message: RegExp) =>
  assert.rejects(
    quietly(() => build(dir, 'publish')),
    message,
  )

describe('comments.url', () => {
  for (const [url, problem] of [
    [null, /config\.lima: comments\.url is missing/],
    ['not-a-url', /config\.lima: comments\.url is no URL/],
    ['http://service.example.net', /config\.lima: comments\.url does not start with https:\/\//],
    ['https://service.example.net?site=1', /config\.lima: comments\.url has a query/],
    ['https://service.example.net?', /config\.lima: comments\.url has a query/],
    // Lima reads a # without a space before it as part of the value
    ['https://service.example.net#note', /config\.lima: comments\.url has a fragment/],
    ['https://user:secret@service.example.net', /config\.lima: comments\.url has a user or password/],
    ['https://:secret@service.example.net', /config\.lima: comments\.url has a user or password/],
    ['https://service.example.net\\', /config\.lima: comments\.url has white space or a backslash/],
    ['"https://service.example.net "', /config\.lima: comments\.url has white space or a backslash/],
    ['" https://service.example.net"', /config\.lima: comments\.url has white space or a backslash/],
  ] as const)
    it(`${url ?? 'none'} stops a publish build and hadley comments alike, and no dev build`, async () => {
      await site('en', HEADING + COMMENTS, ENGLISH)
      await file('config.lima', config('en', url))
      // the value may hold a password or a token: no message shows it
      const refused = (error: Error) => {
        assert.match(error.message, problem)
        assert.doesNotMatch(error.message, /service\.example\.net|secret/)
        return true
      }
      await assert.rejects(
        quietly(() => build(dir, 'publish')),
        refused,
      )
      await assert.rejects(runCommentsCli(dir, { dev: false }), refused)
      await quietly(() => build(dir, 'dev'))
      await quietly(() => build(dir, 'publish', { localServer: true }))
    })

  it('loses a slash at its end, for the published page and for hadley comments', async (t) => {
    await site('en', HEADING + COMMENTS, ENGLISH)
    await file('config.lima', config('en', 'https://comments.example.org/'))
    await quietly(() => build(dir, 'publish'))
    assert.match(await read('.hadley/publish/home/index.html'), /data-service-url="https:\/\/comments\.example\.org"/)
    const service = serviceWith([])
    await moderate(t, service, [])
    assert.deepEqual(service.urls, ['https://comments.example.org/admin/comments'])
  })
})

describe('a build with comments on renders the comments template once', () => {
  it('in a language whose texts take the heading from the default language', async () => {
    await site('en', HEADING + COMMENTS, ENGLISH)
    await file('content/pages/[home]/en-US/home.md', '---\ntitle: Home\n---\n')
    await file('theme/i18n/en-US.lima', 'imprint:\n  address: Mailing address\n')
    await builds()
  })

  it('with a heading of the theme of its own, whose texts have no comments.heading', async () => {
    await site(
      'en',
      '<h2>{ t.comments.title } ({ comments | length })</h2>' + COMMENTS,
      'comments:\n  title: Comments\n',
    )
    await builds()
  })

  it('and names the template, the language and what galley said when a plural form is missing', async () => {
    await site('pl', HEADING + COMMENTS, POLISH)
    await stops(
      /partials[\\/]comments\.sort: 2 comment\(s\) in pl cannot be written: G5003: .*no form "few" for 2 in pl/,
    )
    await file('theme/i18n/pl.lima', `${POLISH}    few: komentarze\n`)
    await builds()
  })

  it('in every count from 3 that selects a plural form which one and two do not', async () => {
    await site('pl', HEADING + COMMENTS, POLISH.replace('    many: komentarzy\n', '    few: komentarze\n'))
    await stops(/comments\.sort: 5 comment\(s\) in pl cannot be written: G5003: .*no form "many" for 5 in pl/)
  })

  it('with two comments also in a language of one plural form', async () => {
    await site('ja', OLD_HEADING + COMMENTS, 'comments:\n  headingSingular: comment\n')
    await stops(/comments\.sort: 2 comment\(s\) in ja cannot be written: G5002: .*t\.comments\.headingPlural/)
  })

  it('and not at all with comments off', async () => {
    await site('pl', HEADING + COMMENTS, POLISH)
    await file('config.lima', config('pl').replace('enabled: true', 'enabled: false'))
    await builds()
  })

  for (const [name, template, texts, message] of [
    [
      'the plural heading with the texts of the old one',
      HEADING,
      'comments:\n  headingSingular: comment\n  headingPlural: comments\n',
      /1 comment\(s\) in en cannot be written: G5003: .*no form "one"/,
    ],
    ['the old heading with the texts of the plural one', OLD_HEADING, ENGLISH, /G5002: .*t\.comments\.headingSingular/],
    [
      'the old heading with one of its two texts',
      OLD_HEADING,
      'comments:\n  headingSingular: comment\n',
      /2 comment\(s\) in en cannot be written: G5002: .*t\.comments\.headingPlural/,
    ],
    [
      'a heading from texts the theme does not have',
      HEADING,
      undefined,
      /comments\.sort: 1 comment\(s\) in en .*G5003/,
    ],
    [
      'a text that only a second comment asks for',
      HEADING + '{#each comments as comment}{#if !isFirst}{ t.comments.between }{/if}{ comment.name }{/each}',
      ENGLISH,
      /2 comment\(s\) in en cannot be written: G5002: .*t\.comments\.between/,
    ],
    [
      "a text that only an owner's reply asks for",
      HEADING +
        '{#each comments as comment}{#each comment.comments as reply}' +
        '{#if reply.author_reply}{ t.comments.owner }{/if}{/each}{/each}',
      ENGLISH,
      /1 comment\(s\) in en cannot be written: G5002: .*t\.comments\.owner/,
    ],
  ] as const)
    it(`and stops for ${name}`, async () => {
      await site('en', template + COMMENTS, texts)
      await stops(message)
    })

  it('and stops for a theme without a comments template', async () => {
    await site('en', HEADING, ENGLISH)
    await rm(join(dir, 'theme/templates/partials/comments.sort'))
    await stops(/the theme has no comments template: .*comments\.sort/)
  })
})

const comment = (id: string, article: string, language: string): QueueEntry => ({
  id,
  parent_comment_id: null,
  article_id: article,
  language_version: language,
  name: `Name ${id}`,
  submitted_at: '2026-01-02T00:00:00Z',
  text: 'Text.',
  email: '',
  notify: false,
})

/** The comments service as `hadley comments` meets it: it gives its queue, and deletes it unless `deletes` is off. */
interface Service {
  queue: QueueEntry[]
  deletes: boolean
  calls: string[] // the method of each request
  urls: string[] // and its URL
}
const serviceWith = (queue: QueueEntry[], deletes = true): Service => ({ queue, deletes, calls: [], urls: [] })

/**
 * Runs `hadley comments` against `service`, pressing `keys` one after another, without its pauses; fails when the
 * moderation asks for more keys than it was given. The failures it reports go into `errors`.
 */
async function moderate(t: TestContext, service: Service, keys: string[], errors: string[] = []): Promise<void> {
  const left = [...keys]
  t.mock.method(globalThis, 'fetch', (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    const method = options?.method ?? 'GET'
    service.calls.push(method)
    service.urls.push(String(url))
    if (method === 'GET') return Promise.resolve(Response.json({ resumed: false, comments: service.queue }))
    if (!service.deletes) return Promise.resolve(new Response(null, { status: 500 }))
    service.queue = []
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  t.mock.method(globalThis, 'setTimeout', (done: () => void) => queueMicrotask(done))
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', (line: string) => errors.push(line))
  t.mock.method(process.stdin, 'resume', () => process.stdin)
  t.mock.method(process.stdin, 'once', (event: string, listener: (chunk: Buffer) => void) => {
    assert.equal(event, 'data')
    const key = left.shift()
    assert.ok(key, 'the moderation asks for a key the test does not press')
    queueMicrotask(() => listener(Buffer.from(key)))
    return process.stdin
  })
  const rawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')
  Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: () => process.stdin })
  const token = process.env.HADLEY_COMMENTS_TOKEN
  process.env.HADLEY_COMMENTS_TOKEN = 'fixture-token'
  try {
    await quietly(() => runCommentsCli(dir, { dev: false }))
    assert.deepEqual(left, [], 'every key was pressed')
  } finally {
    if (rawMode) Object.defineProperty(process.stdin, 'setRawMode', rawMode)
    else Reflect.deleteProperty(process.stdin, 'setRawMode')
    if (token === undefined) delete process.env.HADLEY_COMMENTS_TOKEN
    else process.env.HADLEY_COMMENTS_TOKEN = token
    t.mock.restoreAll()
  }
}

describe('hadley comments, when the theme cannot write the comments of an article', () => {
  const PIECE = 'content/articles/[piece]'
  const OTHER = 'content/articles/[other]'
  const ids = (html: string) => [...html.matchAll(/id="c-([^"]+)"/g)].map((match) => match[1])
  const fixTexts = () => file('theme/i18n/pl.lima', `${POLISH}    few: komentarze\n`)

  // an article with one comment published before; a second comment makes two, the form its Polish texts lack
  beforeEach(async () => {
    await site('pl', HEADING + COMMENTS, POLISH)
    await file(`${PIECE}/piece.md`, '# Piece\n')
    await file(`${OTHER}/other.md`, '# Other\n')
    const old = { ...comment('old', 'piece', 'pl'), submitted_at: '2026-01-01T00:00:00Z', comments: [] }
    await file(`${PIECE}/comments.json`, JSON.stringify([old]))
    await file(`${PIECE}/_comments.html`, '<p>Earlier HTML</p>')
  })

  it('writes them in the next run, which continues a session the owner left', async (t) => {
    const service = serviceWith([comment('c1', 'piece', 'pl'), comment('c2', 'other', 'pl')])
    await assert.rejects(moderate(t, service, ['a', 'q']), /The comments of 1 article\(s\) were not written/)
    assert.equal(await read(`${PIECE}/_comments.html`), '<p>Earlier HTML</p>')
    assert.deepEqual(service.calls, ['GET'], 'a comment is left to decide: the service keeps its batch')

    await fixTexts()
    await moderate(t, service, ['a'])
    assert.deepEqual(service.calls, ['GET', 'DELETE'])
    const piece = await read(`${PIECE}/_comments.html`)
    assert.match(piece, /<h2>2 komentarze<\/h2>/)
    assert.deepEqual(ids(piece), ['old', 'c1'])
    assert.deepEqual(ids(await read(`${OTHER}/_comments.html`)), ['c2'])
  })

  it('writes them in the next run, which finds nothing new: the service deleted what was decided', async (t) => {
    const service = serviceWith([comment('new', 'piece', 'pl')])
    await assert.rejects(moderate(t, service, ['a']), /The comments of 1 article\(s\) were not written/)
    assert.equal(await read(`${PIECE}/_comments.html`), '<p>Earlier HTML</p>')
    assert.deepEqual(service.calls, ['GET', 'DELETE'], 'the approved comment is in comments.json')

    await fixTexts()
    await moderate(t, service, [])
    assert.deepEqual(service.calls, ['GET', 'DELETE', 'GET'])
    const piece = await read(`${PIECE}/_comments.html`)
    assert.match(piece, /<h2>2 komentarze<\/h2>/)
    assert.deepEqual(ids(piece), ['old', 'new'])
  })

  it('writes them once in the next run, to which the service gives the same comments again', async (t) => {
    const service = serviceWith([comment('new', 'piece', 'pl')], false)
    await assert.rejects(moderate(t, service, ['a']), /The comments of 1 article\(s\) were not written/)

    await fixTexts()
    await moderate(t, service, ['a'])
    const published: { id: string }[] = JSON.parse(await read(`${PIECE}/comments.json`))
    assert.deepEqual(
      published.map(({ id }) => id),
      ['old', 'new'],
    )
    const piece = await read(`${PIECE}/_comments.html`)
    assert.match(piece, /<h2>2 komentarze<\/h2>/)
    assert.deepEqual(ids(piece), ['old', 'new'])
  })

  it('goes on with the articles after one that failed, names it, and fails itself', async (t) => {
    const two = ['old', 'more'].map((id) => ({ ...comment(id, 'piece', 'pl'), comments: [] }))
    await file(`${PIECE}/comments.json`, JSON.stringify(two))
    // in another language, and after the article that fails
    const SEQUEL = 'content/articles/[sequel]/en'
    await file(`${SEQUEL}/sequel.md`, '# Sequel\n')
    await file(`${SEQUEL}/comments.json`, JSON.stringify([{ ...comment('en1', 'sequel', 'en'), comments: [] }]))
    await file('theme/i18n/en.lima', ENGLISH)
    const errors: string[] = []
    await assert.rejects(moderate(t, serviceWith([]), [], errors), /1 article\(s\) were not written/)
    assert.equal(errors.length, 1)
    assert.match(errors[0]!, /failed: piece \(pl\): .*no form "few" for 2 in pl/)
    assert.equal(await read(`${PIECE}/_comments.html`), '<p>Earlier HTML</p>')
    assert.match(await read(`${SEQUEL}/_comments.html`), /<h2>1 comment<\/h2><p id="c-en1">/)
  })
})
