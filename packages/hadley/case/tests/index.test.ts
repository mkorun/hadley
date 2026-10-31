import { before, describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
import { extract } from '../index.ts'
import { highlighting } from './built.ts'

before(() => highlighting('nord'))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const html = (rawDoc: string, opts = {}) => extract(rawDoc, opts).html
const meta = (rawDoc: string, opts = {}) => extract(rawDoc, opts).metadata

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns empty metadata for empty string', () => {
    assert.deepEqual(meta(''), {})
  })

  it('returns empty metadata when no frontmatter is present', () => {
    const input = 'Just some content.\n\nNo metadata here.'
    assert.deepEqual(meta(input), {})
  })

  it('does not parse frontmatter if document does not start with ---', () => {
    const input = 'Some text\n---\ntitle: Trick\n---\n'
    assert.equal(meta(input).title, undefined)
  })
})

// ─── Title extraction ─────────────────────────────────────────────────────────

describe('title extraction', () => {
  it('takes the title from a level-1 heading that is the first block, and leaves it out of the html', () => {
    const result = extract('# Hello *World* {#hello}\n\nBody text.', {})
    assert.equal(result.metadata.title, 'Hello World')
    assert.ok(!result.html.includes('<h1'))
    assert.ok(result.html.includes('Body text.'))
  })

  it('reports a title given twice, in the front matter and as the first heading, and keeps both', () => {
    const result = extract('---\ntitle: Frontmatter Title\n---\n# H1 Title\n', {})
    assert.equal(result.metadata.title, 'Frontmatter Title')
    assert.ok(result.html.includes('<h1'))
    assert.deepEqual(
      result.parseErrors?.map((error) => error.message),
      [
        'the title is given twice, as title in the front matter and as the first # heading: keep one ' +
          '(a shorter name for navigations is linktext)',
      ],
    )
    assert.equal(extract('---\ntitle: T\n---\nIntro.\n\n# Later\n', {}).parseErrors, undefined)
    const alias = extract('---\ntitel: Frontmatter-Titel\n---\n# H1-Titel', { aliases: { titel: 'title' } })
    assert.equal(alias.metadata.title, 'Frontmatter-Titel')
    assert.ok(alias.html.includes('H1-Titel</h1>'))
  })

  // review 2026-10-23: a regex took the first `# ` line anywhere, out of code and :::nocount too
  it('takes no title from a heading after the first block, from code or from a container', () => {
    assert.equal(meta('Intro.\n\n# Late heading\n').title, undefined)
    assert.ok(html('Intro.\n\n# Late heading\n').includes('Late heading</h1>'))
    const code = extract('```sh\n# a comment\necho\n```\n', {})
    assert.equal(code.metadata.title, undefined)
    assert.ok(code.html.includes('# a comment'))
    assert.equal(meta('::: nocount\n# Excluded\n:::\n').title, undefined)
  })

  // review 2026-10-24: the footnote of a title was left in the text, pointing back to nothing
  it('reports a footnote in the title or the subtitle, which a title cannot show', () => {
    const result = extract('# A[^1]\n__B[^2]__\n\nText.\n\n[^1]: one\n\n[^2]: two\n', {})
    assert.deepEqual(result.metadata, { title: 'A', subtitle: 'B' })
    assert.deepEqual(
      result.parseErrors?.map((error) => error.message),
      [
        'the title (the first # heading) holds a footnote, which a title cannot show',
        'the subtitle (the bold line under the title) holds a footnote, which a subtitle cannot show',
      ],
    )
    assert.equal(extract('# A\n\nText[^1].\n\n[^1]: one\n', {}).parseErrors, undefined)
  })

  it('takes no title from a setext heading, which Markanto does not have', () => {
    const result = extract('Hello World\n===========\n\nBody text.', {})
    assert.equal(result.metadata.title, undefined)
    assert.ok((result.parseErrors?.length ?? 0) > 0)
  })

  it('takes the subtitle from a bold line right after the title heading, and leaves it out of the html', () => {
    for (const source of ['# Titel\n__Mein Untertitel__\n\nBody.', '# Titel\n\n**Mein Untertitel**\n\nBody.']) {
      const result = extract(source, {})
      assert.deepEqual(result.metadata, { title: 'Titel', subtitle: 'Mein Untertitel' })
      assert.equal(result.html, '<p>Body.</p>')
    }
  })

  it('takes no subtitle from a line that is not one bold span, or after a heading that supplies no title', () => {
    assert.equal(meta('# Titel\n_Kursiv_\n').subtitle, undefined)
    assert.equal(meta('# Titel\n__Fett__ und mehr\n').subtitle, undefined)
    assert.equal(meta('Intro.\n\n__Fett__\n').subtitle, undefined)
    const titled = extract('---\ntitle: T\n---\n# H1\n__Fett__\n', {})
    assert.equal(titled.metadata.subtitle, undefined)
    assert.ok(titled.html.includes('<strong>Fett</strong>'))
  })

  it('prefers the front matter subtitle, and then keeps the bold line where it is', () => {
    const result = extract('---\nsubtitle: Aus dem Front Matter\n---\n# Titel\n__Fett__\n', {})
    assert.equal(result.metadata.subtitle, 'Aus dem Front Matter')
    assert.ok(result.html.includes('<strong>Fett</strong>'))
  })
})

// ─── Frontmatter ──────────────────────────────────────────────────────────────

describe('frontmatter', () => {
  it('parses frontmatter fields', () => {
    const m = meta('---\nstatus: draft\ndate: 2026-05-01\n---')
    assert.equal(m.status, 'draft')
    assert.ok(m.date instanceof Date)
  })

  it('parses LIMA inline arrays', () => {
    assert.deepEqual(meta('---\ntags: [a, b, c]\n---').tags, ['a', 'b', 'c'])
  })

  it('parses LIMA block arrays', () => {
    assert.deepEqual(meta('---\ntags:\n  - one\n  - two\n---').tags, ['one', 'two'])
  })

  it('parses LIMA maps', () => {
    // LIMA makes objects without a prototype; the values are what counts here
    assert.deepEqual(
      { ...meta('---\nauthor:\n  name: Alice\n  url: https://example.com\n---').author },
      {
        name: 'Alice',
        url: 'https://example.com',
      },
    )
  })

  it('html does not contain frontmatter delimiters', () => {
    const out = html('---\ntitle: Test\n---\n\nBody here.')
    assert.ok(!out.includes('---'))
    assert.ok(out.includes('Body here.'))
  })

  it('html is empty when document has only frontmatter', () => {
    assert.equal(html('---\ntitle: Test\n---').trim(), '')
  })

  it('reads a front matter whose lines of --- end in spaces', () => {
    const m = meta('---  \nstatus: draft\n---   \n\nBody.')
    assert.equal(m.status, 'draft')
  })

  it('places a Lima error after an opening line that ends in spaces', () => {
    const doc = '---   \ntitle: X\nbad line\n---\n\nBody.'
    const [error] = extract(doc, {}).parseErrors ?? []
    assert.match(error?.message ?? '', /^front matter: /)
    assert.equal(error?.start, doc.indexOf('bad line'))
  })

  // review 2026-10-29: `---x` closed the front matter, and x became text of the body
  it('closes the front matter only with a whole line of ---', () => {
    for (const closing of ['---x', '--- x', '---\tX']) {
      const r = extract(`---\ntitle: Parsed\n${closing}\n\nBody.`, {})
      assert.equal(r.metadata.title, undefined, closing)
      assert.deepEqual(r.parseErrors?.[0], { message: 'front matter: it has no closing line of ---', start: 0 })
    }
    for (const closing of ['---', '---  ', '---\r']) {
      assert.equal(meta(`---\ntitle: Parsed\n${closing}\n\nBody.`).title, 'Parsed', JSON.stringify(closing))
    }
    assert.equal(meta('---\ntitle: Parsed\n---').title, 'Parsed')
  })

  it('rejects the front matter of an HTML comment, <!--- … --->', () => {
    const r = extract('<!---\ntitle: X\n--->\n\nBody.', {})
    assert.equal(r.metadata.title, undefined)
    assert.deepEqual(r.parseErrors?.[0], {
      message: 'front matter: it stands between two lines of ---, not in <!--- … --->',
      start: 0,
    })
  })
})

// ─── Aliases ──────────────────────────────────────────────────────────────────

describe('aliases', () => {
  it('maps alias to canonical key in frontmatter', () => {
    const m = meta('---\ntitel: Hallo\n---', { aliases: { titel: 'title' } })
    assert.equal(m.title, 'Hallo')
    assert.equal(m.titel, undefined)
  })

  it('maps multiple aliases', () => {
    const m = meta('---\ntitel: Hallo\ndatum: 2026-05-20\n---', {
      aliases: { titel: 'title', datum: 'date' },
    })
    assert.equal(m.title, 'Hallo')
    assert.ok(m.date instanceof Date)
  })

  it('leaves canonical key unaffected when alias is not used', () => {
    assert.equal(meta('---\ntitle: Hello\n---', { aliases: { titel: 'title' } }).title, 'Hello')
  })

  it('takes a gendered name with a colon, which LIMA reads as a key', () => {
    assert.equal(meta('---\nautor:in: Noa\n---', { aliases: { 'autor:in': 'author' } }).author, 'Noa')
  })

  // LIMA Core 1.2: keys in any script, and with * or · after their first character, need no quotes
  it('takes names in other scripts and gendered with * or ·, unquoted', () => {
    const aliases = { größe: 'size', 題名: 'title', 'autor*in': 'author', autor·in: 'editor' }
    const m = meta('---\ngröße: 3\n題名: Hallo\nautor*in: Noa\nautor·in: Ada\n---', { aliases })
    assert.deepEqual([m.size, m.title, m.author, m.editor], [3, 'Hallo', 'Noa', 'Ada'])
  })

  // 2026-10-29: the key was lower-cased before it was looked up, so an alias Autor never matched and AUTOR did
  it('counts an alias as it is spelled', () => {
    const r = extract('---\nAUTOR: Ada\nTitel: T\n---', { aliases: { autor: 'author', Titel: 'title' } })
    assert.equal(r.metadata.author, undefined)
    assert.equal(r.metadata.AUTOR, 'Ada')
    assert.equal(r.metadata.title, 'T')
  })

  // 2026-10-30: a key typed with a combining mark (NFD) missed the alias written with the composed letter (NFC)
  it('counts a key and an alias in their composed form', () => {
    const decomposed = 'pru\u0308fer'
    assert.equal(meta(`---\n"${decomposed}": Noa\n---`, { aliases: { prüfer: 'author' } }).author, 'Noa')
    const r = extract(`---\n"${decomposed}": Noa\n---`, {})
    assert.deepEqual(
      Object.keys(r.metadata).filter((key) => key.startsWith('pr')),
      ['prüfer'],
    )
    const twice = extract(`---\n"prüfer": Ada\n"${decomposed}": Bea\n---`, {})
    assert.equal(twice.metadata['prüfer'], 'Ada')
    assert.deepEqual(twice.parseErrors, [
      { message: `front matter: ${decomposed} is given twice, in two Unicode forms of one name; keep one` },
    ])
  })

  it('keeps the first of a field given twice, and says so', () => {
    for (const [doc, kept, message] of [
      [
        '---\nauthor: Ada\nautor: Bea\n---',
        'Ada',
        'front matter: author and autor are both the field author; keep one',
      ],
      [
        '---\nautor: Ada\nauthor: Bea\n---',
        'Ada',
        'front matter: autor and author are both the field author; keep one',
      ],
      [
        '---\nautor: Ada\nautorin: Bea\n---',
        'Ada',
        'front matter: autor and autorin are both the field author; keep one',
      ],
    ] as const) {
      const r = extract(doc, { aliases: { autor: 'author', autorin: 'author' } })
      assert.equal(r.metadata.author, kept)
      assert.deepEqual(r.parseErrors, [{ message }])
    }
  })
})

// ─── Defaults ─────────────────────────────────────────────────────────────────

describe('defaults', () => {
  it('applies default when field is missing', () => {
    assert.equal(meta('', { defaults: { author: 'Default Author' } }).author, 'Default Author')
  })

  it('does not overwrite existing value with default', () => {
    assert.equal(meta('---\nauthor: Alice\n---', { defaults: { author: 'Default Author' } }).author, 'Alice')
  })
})

// ─── id ───────────────────────────────────────────────────────────────────────

// review 2026-10-25: case dropped an id in silence; hadley's load-site refuses it as a field hadley sets itself
describe('id', () => {
  it('keeps an id of the front matter, for hadley to decide about', () => {
    assert.equal(meta('---\nid: my-id\n---').id, 'my-id')
  })
})

// ─── Combined: frontmatter + markdown in one pass ─────────────────────────────

describe('combined document', () => {
  it('returns both metadata and html from a full document', () => {
    const doc = `---
status: published
tags: [ts, bun]
---
# Mein Artikel
__Ein Untertitel__

Ein Absatz mit **fettem** Text.

## Abschnitt

Eine Liste:
- Punkt eins
- Punkt zwei
`
    const result = extract(doc, {})
    assert.equal(result.metadata.title, 'Mein Artikel')
    assert.equal(result.metadata.status, 'published')
    assert.deepEqual(result.metadata.tags, ['ts', 'bun'])
    assert.equal(result.metadata.subtitle, 'Ein Untertitel')
    assert.ok(!result.html.includes('<h1'))
    assert.ok(result.html.includes('<h2'))
    assert.ok(result.html.includes('<strong>'))
    assert.ok(result.html.includes('<li>'))
  })

  it('toc contains headings from body (not the extracted H1)', () => {
    const doc = '---\nstatus: draft\n---\n# H1 Title\n\n## Section One\n\n## Section Two\n'
    const result = extract(doc, {})
    const tocIds = result.toc.map((e) => e.text)
    assert.ok(!tocIds.includes('H1 Title'))
    assert.ok(tocIds.includes('Section One'))
    assert.ok(tocIds.includes('Section Two'))
  })

  it('externalLinks collected from markdown body', () => {
    const doc = '---\ntitle: Links\n---\n\nSiehe [Beispiel](https://example.com).'
    const result = extract(doc, {})
    assert.ok(result.externalLinks.includes('https://example.com'))
  })
})

// ─── External links (renderer) ────────────────────────────────────────────────

describe('external links', () => {
  test('https link gets target="_blank" and rel', () => {
    const out = html('[Beispiel](https://example.com)')
    assert.ok(out.includes('target="_blank"'))
    assert.ok(out.includes('rel="noopener noreferrer"'))
  })

  test('internal link does NOT get target="_blank"', () => {
    assert.ok(!html('[Intern](/ueber-mich/)').includes('target="_blank"'))
  })
})

// ─── Block-Editor: extract() → onBlocks → getBlockId → data-hadley-id ─────────
// Critical integration test: proves the whole pipeline from offset tracking
// through the onBlocks hook to the data-hadley-id injection in the rendered HTML.

describe('block editor integration: getBlockId → data-hadley-id in HTML', () => {
  it('injects data-hadley-id into a paragraph via getBlockId', () => {
    const startToId = new Map<number, string>()
    const rawDoc = '---\ntitle: Test\n---\n\nErster Absatz.\n\nZweiter Absatz.\n'

    const result = extract(rawDoc, {
      bundlePath: '',
      onBlocks: (blocks) => {
        for (const b of blocks) {
          if (b.start !== undefined) startToId.set(b.start, `id-${b.start}`)
        }
      },
      getBlockId: (start) => startToId.get(start),
    })

    // Both paragraphs must carry data-hadley-id
    assert.ok(result.html.includes('data-hadley-id="id-'))
    assert.equal((result.html.match(/data-hadley-id=/g) ?? []).length, 2)
  })

  it('baseOffset: IDs point to file-absolute positions in rawDoc', () => {
    const startToId = new Map<number, string>()
    const frontmatter = '---\ntitle: T\n---\n\n'
    const rawDoc = frontmatter + 'Absatz eins.\n\nAbsatz zwei.\n'

    extract(rawDoc, {
      bundlePath: '',
      onBlocks: (blocks) => {
        for (const b of blocks) {
          if (b.start !== undefined) startToId.set(b.start, `pos${b.start}`)
        }
      },
      getBlockId: (start) => startToId.get(start),
    })

    // Offsets must point into rawDoc (file-absolute)
    for (const [start] of startToId) {
      assert.match(rawDoc.slice(start), /^Absatz/)
    }
  })

  it('getBlockId without onBlocks still sets data-hadley-id (an inconsistent call)', () => {
    // onBlocks builds the map; without onBlocks getBlockId always returns undefined
    const result = extract('Absatz.\n', {
      bundlePath: '',
      getBlockId: () => 'should-not-appear',
    })
    // getBlockId is called, but without onBlocks it knows no starts
    // This function returns 'should-not-appear' for EVERY start anyway →
    // data-hadley-id appears (which is correct, since getBlockId is called)
    assert.ok(result.html.includes('data-hadley-id="should-not-appear"'))
  })

  it('writes no data-hadley-id when getBlockId is not set', () => {
    const result = extract('Absatz.\n', { bundlePath: '' })
    assert.ok(!result.html.includes('data-hadley-id'))
  })

  it('does not register the H1 as a block editor block', () => {
    const startToId = new Map<number, string>()
    const rawDoc = '# Mein Titel\n\nNur ein Absatz.\n'

    extract(rawDoc, {
      bundlePath: '',
      onBlocks: (blocks) => {
        for (const b of blocks) {
          if (b.start !== undefined) startToId.set(b.start, `id-${b.start}`)
        }
      },
      getBlockId: (start) => startToId.get(start),
    })

    // extract() removes the H1; the reference parser gets only the body.
    // Only the paragraph is in the map
    assert.equal(startToId.size, 1)
  })
})
