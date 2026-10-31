import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { pictureHtml, renderBuilt } from './built.ts'
import { readDestination, type Destination, type Use } from '../destination.ts'

const options = { bundlePath: '/content/[test]', lang: 'de' }

// As a page at /p/ reads them: what a browser resolves from any page at that path, whatever the spelling.

describe('readDestination', () => {
  const read = (raw: string, use: Use = 'link') => readDestination(raw, use, '/p/')

  for (const row of [
    ['', 'link', { kind: 'self', href: '' }],
    ['#fragment', 'link', { kind: 'self', href: '#fragment' }],
    ['?q', 'link', { kind: 'self', href: '?q' }],
    ['https://example.com', 'link', { kind: 'external', href: 'https://example.com', scheme: 'https:' }],
    ['HTTPS://example.com', 'link', { kind: 'external', href: 'HTTPS://example.com', scheme: 'https:' }],
    ['http://example.com', 'link', { kind: 'external', href: 'http://example.com', scheme: 'http:' }],
    ['https://site.invalid/p/', 'link', { kind: 'external', href: 'https://site.invalid/p/', scheme: 'https:' }],
    ['mailto:x@example.com', 'link', { kind: 'external', href: 'mailto:x@example.com', scheme: 'mailto:' }],
    ['tel:+49123', 'link', { kind: 'external', href: 'tel:+49123', scheme: 'tel:' }],
    ['https://example.com/x', 'resource', { kind: 'external', href: 'https://example.com/x', scheme: 'https:' }],
    ['https://example.com/embed', 'embed', { kind: 'external', href: 'https://example.com/embed', scheme: 'https:' }],
    ['x.pdf', 'link', { kind: 'bundle', rel: 'x.pdf', suffix: '' }],
    ['./sub/a%20b.pdf?download=1#page=2', 'link', { kind: 'bundle', rel: 'sub/a b.pdf', suffix: '?download=1#page=2' }],
    ['caf%C3%A9.pdf', 'link', { kind: 'bundle', rel: 'café.pdf', suffix: '' }],
    ['z.jpg', 'resource', { kind: 'bundle', rel: 'z.jpg', suffix: '' }],
    ['sub/../z.jpg', 'resource', { kind: 'bundle', rel: 'z.jpg', suffix: '' }],
    // the parser decoded the entity once; a browser reads the rest as a path and a fragment
    ['&#36;missing', 'link', { kind: 'bundle', rel: '&', suffix: '#36;missing' }],
    // written as they resolve, not as they are spelled
    ['./', 'link', { kind: 'path', path: 'p/', suffix: '', href: '/p/' }],
    ['/x', 'link', { kind: 'path', path: 'x', suffix: '', href: '/x' }],
    ['/', 'link', { kind: 'path', path: '', suffix: '', href: '/' }],
    ['a/', 'link', { kind: 'path', path: 'p/a/', suffix: '', href: '/p/a/' }],
    ['../missing/', 'link', { kind: 'path', path: 'missing/', suffix: '', href: '/missing/' }],
    ['/./target/', 'link', { kind: 'path', path: 'target/', suffix: '', href: '/target/' }],
    ['/other/../other/', 'link', { kind: 'path', path: 'other/', suffix: '', href: '/other/' }],
    ['/%2e/target/', 'link', { kind: 'path', path: 'target/', suffix: '', href: '/target/' }],
    ['/a\\b/', 'link', { kind: 'path', path: 'a/b/', suffix: '', href: '/a/b/' }],
    [
      '/pagefind/x.js?x=1#f',
      'link',
      { kind: 'path', path: 'pagefind/x.js', suffix: '?x=1#f', href: '/pagefind/x.js?x=1#f' },
    ],
    ['/assets/a.css', 'resource', { kind: 'path', path: 'assets/a.css', suffix: '', href: '/assets/a.css' }],
    ['../x.png', 'resource', { kind: 'path', path: 'x.png', suffix: '', href: '/x.png' }],
    ['/x', 'data', { kind: 'path', path: 'x', suffix: '', href: '/x' }],
  ] as Array<[string, Use, unknown]>) {
    const [raw, use, expected] = row
    test(`reads ${JSON.stringify(raw)} for a ${use}`, () => {
      assert.deepEqual(read(raw, use) as unknown, expected)
    })
  }

  for (const row of [
    ['javascript:alert(1)', 'link'],
    ['JAVASCRIPT:alert(1)', 'link'],
    [' javascript:alert(1)', 'link'],
    ['\tjavascript:alert(1)', 'link'],
    ['java\tscript:alert(1)', 'link'],
    ['java\nscript:alert(1)', 'link'],
    ['vbscript:x', 'link'],
    ['weird:value', 'link'],
    // review 2026-10-26: another host, or another meaning on another origin
    ['//example.com/x', 'link'],
    ['\\\\example.com/x', 'link'],
    ['/\\example.com/x', 'link'],
    ['//a.invalid/p/', 'link'],
    ['//site.invalid/p/', 'link'],
    ['\\\\site.invalid/p/', 'link'],
    ['https:/other/', 'link'],
    ['https:foo', 'link'],
    ['/evil//', 'link'],
    ['/a%2Fb/', 'link'],
    ['/a%5Cb/', 'link'],
    ['data:text/html,x', 'resource'],
    ['file:///etc/passwd', 'resource'],
    ['blob:https://example.com/id', 'resource'],
    ['mailto:x@example.com', 'resource'],
    ['tel:123', 'resource'],
    ['%zz.png', 'resource'],
    ['?missing', 'resource'],
    ['/', 'resource'],
    ['../other/', 'resource'],
    ['http://example.com/embed', 'embed'],
    ['/relative-embed', 'embed'],
    ['https://[bad]', 'embed'],
    ['javascript:x', 'data'],
    ['//example.com/x', 'data'],
  ] as Array<[string, Use]>) {
    const [raw, use] = row
    test(`refuses ${JSON.stringify(raw)} for a ${use}`, () => {
      assert.equal(read(raw, use).kind, 'refused')
    })
  }

  // review 2026-10-26: a fixed sentinel path took r and /q/r for this page
  test('takes only a destination without a path of its own for this page', () => {
    assert.deepEqual(read('r'), { kind: 'bundle', rel: 'r', suffix: '' })
    assert.deepEqual(read('./r?x#f'), { kind: 'bundle', rel: 'r', suffix: '?x#f' })
    assert.deepEqual(read('/q/r'), { kind: 'path', path: 'q/r', suffix: '', href: '/q/r' })
    assert.deepEqual(read('/q/./r'), { kind: 'path', path: 'q/r', suffix: '', href: '/q/r' })
    assert.deepEqual(read('r', 'resource'), { kind: 'bundle', rel: 'r', suffix: '' })
  })

  // review 2026-10-26: an absolute URL on the site's own origin was external, so nothing checked the file it names
  test('reads an absolute URL on the site’s own origin as a site path, written as given', () => {
    const own = (raw: string, use: Use = 'link') => readDestination(raw, use, '/p/', 'https://site.example')
    assert.deepEqual(own('https://site.example/x.pdf?a#b'), {
      kind: 'path',
      path: 'x.pdf',
      suffix: '?a#b',
      href: 'https://site.example/x.pdf?a#b',
    })
    assert.equal(own('https://site.example/p/', 'resource').kind, 'refused')
    // review 2026-10-26: another spelling of the same origin counted as another site
    assert.equal(readDestination('https://site.example/x.pdf', 'link', '/p/', 'https://SITE.example:443').kind, 'path')
    assert.deepEqual(own('https://other.example/x.pdf'), {
      kind: 'external',
      href: 'https://other.example/x.pdf',
      scheme: 'https:',
    })
  })

  test('reads a relative destination against the page it is on', () => {
    assert.deepEqual(readDestination('../x/', 'link', '/en/a/'), {
      kind: 'path',
      path: 'en/x/',
      suffix: '',
      href: '/en/x/',
    })
    assert.deepEqual(readDestination('b.png', 'resource', '/en/a/'), { kind: 'bundle', rel: 'b.png', suffix: '' })
    assert.deepEqual(readDestination('../b.png', 'resource', '/'), { kind: 'bundle', rel: 'b.png', suffix: '' })
  })
})

// Through parseDocument() and render(), the production path, with the images built as in tests/built.ts.
const rendered = (source: string) => renderBuilt(source, options)
const refusedOf = (result: ReturnType<typeof rendered>) =>
  result.refs.filter((ref) => ref.kind === 'refused').map((ref) => ref.destination)

describe('renderer URL policy', () => {
  // review 2026-10-26: a blocked URL was a warning of its own; every destination a page may not have is refused
  test('shows a refused link as its label and names it, so a published page fails', () => {
    const result = rendered('[x](javascript:alert(1))')
    assert.equal(
      result.html,
      '<p>x<!-- not built: javascript:alert(1) has a scheme a link may not have (javascript:) --></p>',
    )
    assert.deepEqual(refusedOf(result), ['javascript:alert(1)'])
    assert.deepEqual(result.externalLinks, [])
  })

  test('refuses an entity-obfuscated scheme, which the parser decoded', () => {
    assert.deepEqual(refusedOf(rendered('[x](java&#115;cript:alert(1))')), ['javascript:alert(1)'])
  })

  test('refuses a destination that names another host without a scheme', () => {
    assert.deepEqual(refusedOf(rendered('[x](//evil.example/x) [y](//a.invalid/) ![z](//site.invalid/z.png)')), [
      '//evil.example/x',
      '//a.invalid/',
      '//site.invalid/z.png',
    ])
  })

  test('shows no refused image, and names nothing of it', () => {
    const result = rendered('![x](data:image/png;base64,AAAA)')
    assert.ok(!result.html.includes('<img'))
    assert.deepEqual(result.refs, [
      {
        kind: 'refused',
        destination: 'data:image/png;base64,AAAA',
        reason: 'has a scheme a file may not have (data:)',
      },
    ])
  })

  test('refuses a preview it may not show while keeping the media', () => {
    const result = rendered('<m video preview=file:///etc/passwd>[Film](film.mp4)</m>')
    assert.ok(result.html.includes('<source src="film.mp4"'))
    assert.ok(!result.html.includes('poster='))
    assert.deepEqual(
      result.refs.map((ref) => ref.kind),
      ['copy', 'refused'],
    )
  })

  test('refuses media and embeds it may not show, and every embed but an https one', () => {
    const video = rendered('<m video>[Film](data:video/mp4,AAAA)</m>')
    assert.ok(!video.html.includes('<video'))
    assert.deepEqual(refusedOf(video), ['data:video/mp4,AAAA'])
    for (const target of ['http://example.com/embed', 'https://[bad]', '/embed']) {
      const embed = rendered(`<m embed>[Demo](${target})</m>`)
      assert.ok(!embed.html.includes('<iframe'))
      assert.deepEqual(refusedOf(embed), [target])
    }
  })

  // review 2026-10-26: a download of the page itself, and an image that is the page, passed
  test('refuses a resource that is this page', () => {
    assert.deepEqual(refusedOf(rendered('<m download>[x](/)</m>\n\n![y](?missing)')), ['/', '?missing'])
  })

  test('recognises allowed schemes case-insensitively in renderer bookkeeping', () => {
    const result = rendered('[x](HTTPS://example.com)\n\n![x](HTTPS://example.com/x.jpg)')
    assert.ok(result.html.includes('target="_blank"'))
    assert.ok(result.html.includes('<img src="HTTPS://example.com/x.jpg"'))
    assert.deepEqual(result.externalLinks, ['HTTPS://example.com'])
    assert.deepEqual(result.refs, [])
  })

  test('keeps normal links and images, and writes a site path as it resolves', () => {
    const result = rendered('[x](/y) [w](/./a/../y/)\n\n![x](z.jpg)')
    assert.ok(result.html.includes('<a href="/y">x</a> <a href="/y/">w</a>'))
    assert.ok(result.html.includes(`<figure>\n${pictureHtml('z.jpg', 'x')}\n</figure>`))
    assert.deepEqual(result.refs, [
      { kind: 'path', destination: '/y' },
      { kind: 'path', destination: '/./a/../y/' },
      { kind: 'image', destination: 'z.jpg' },
    ])
  })

  test('refuses a destination-shaped data attribute it may not have, and writes one as it resolves', () => {
    const result = rendered('<m data-href=javascript:x data-src=./a/../b data-label=kept>x</m>')
    assert.equal(result.html, '<p><span data-src="/b" data-label="kept">x</span></p>')
    assert.deepEqual(refusedOf(result), ['javascript:x'])
  })

  test("keeps Pagefind's attributes from content, as they steer the site's search", () => {
    const result = rendered('<m data-pagefind-filter=x data-pagefind-meta=y data-label=kept>x</m>')
    assert.equal(result.html, '<p><span data-label="kept">x</span></p>')
  })

  test('reads a data attribute that ends in link as a destination too', () => {
    const result = rendered('<m data-link=javascript:x>x</m>')
    assert.equal(result.html, '<p><span>x</span></p>')
    assert.deepEqual(refusedOf(result), ['javascript:x'])
  })
})
