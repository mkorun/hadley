import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@markantolang/parser'
import { extract, parseDocument, render as renderDocument } from '../index.ts'
import { editorBlocks } from '../markanto-native-renderer.ts'
import { highlighting, pictureHtml, renderBuilt } from './built.ts'

before(() => highlighting('nord'))

// The native renderer is the only one; these tests drive it through parseDocument() and render(), the production
// path, with the bundle images built as tests/built.ts does in place of lib/build-files.ts.

// a page at /p/, which relative destinations resolve against
const options = { bundlePath: '/content/[test]', urlPath: '/p/', lang: 'de' }
const render = (source: string) => renderBuilt(source, options)
const html = (source: string) => render(source).html
const figure = (src: string, alt: string, attrs = '', caption?: string) =>
  `<figure${attrs}>\n${pictureHtml(src, alt)}${caption ? `\n<figcaption>${caption}</figcaption>` : ''}\n</figure>`
const blocks = (source: string, baseOffset = 0) =>
  editorBlocks(parse(source, { errorRecovery: true }), baseOffset, source)

describe('native renderer: inline semantics', () => {
  test('an <m> with data-size or data-style inside text puts them on a plain <img>', () => {
    const bundle = render('Text <m data-size=50%>![x](bundle.jpg)</m> Ende.')
    assert.equal(bundle.html, '<p>Text <img src="bundle.jpg" alt="x" data-size="50%"> Ende.</p>')
    assert.deepEqual(bundle.refs, [{ kind: 'copy', destination: 'bundle.jpg' }])

    assert.equal(
      html('Text <m data-size=25%>![x](/site-asset.png)</m> Ende.'),
      '<p>Text <img src="/site-asset.png" alt="x" data-size="25%"> Ende.</p>',
    )
    assert.equal(
      html('Text <m data-size=50% data-style=doc>![x](bundle.jpg)</m> Ende.'),
      '<p>Text <img src="bundle.jpg" alt="x" data-size="50%" data-style="doc"> Ende.</p>',
    )
  })

  // Markanto 0.1.0 lets a kindless <m> attach metadata such as lang to an image; it stays on the image.
  test('an <m> keeps lang and other data-* on an image', () => {
    assert.equal(
      html('Text <m data-size=25% lang=fr data-credit=me>![x](/a.png)</m> Ende.'),
      '<p>Text <img src="/a.png" alt="x" data-size="25%" lang="fr" data-credit="me"> Ende.</p>',
    )
    assert.equal(html('<m lang=fr>![x](/a.png)</m>\n'), '<img src="/a.png" alt="x" lang="fr">')
    assert.equal(
      html('Text <m lang=fr>![x](b.jpg)</m> Ende.'),
      `<p>Text ${figure('b.jpg', 'x', ' lang="fr"')} Ende.</p>`,
    )
    assert.equal(html('<m lang=fr>![x](b.jpg)</m>\n'), figure('b.jpg', 'x', ' lang="fr"'))
    const group = render('<m group=g lang=fr data-size=50%>![x](b.jpg)</m>\n<m group=g>![y](c.jpg)</m>\n')
    // the group's config sizes its images, so they carry no data-size
    assert.equal(
      group.html,
      `<div class="image-group">\n${figure('b.jpg', 'x', ' lang="fr"')}\n${figure('c.jpg', 'y')}\n</div>`,
    )
    assert.deepEqual(group.refs, [
      { kind: 'image', destination: 'b.jpg', config: 'g' },
      { kind: 'image', destination: 'c.jpg', config: 'g' },
    ])
  })

  // review 2026-10-23: a group named by content could collide, vanish (__proto__) or be changed by typography
  test('each run of a group is its own figure; the name only selects the config', () => {
    const result = render(
      '<m group=g>![x](a.png)</m>\n\nText\n\n<m group=g>![y](b.png)</m>\n\n<m group="__proto__">![z](c.png)</m>\n',
    )
    assert.equal(result.html, `${figure('a.png', 'x')}\n<p>Text</p>\n${figure('b.png', 'y')}\n${figure('c.png', 'z')}`)
    assert.deepEqual(
      result.refs.map((ref) => ref.config),
      ['g', 'g', '__proto__'],
    )
  })

  // review 2026-10-23: a group's caption, and an image in it, were dropped
  test('an image in a group keeps its caption, and an image in the caption is named', () => {
    const result = render('<m group=g>![x](a.png)\\\n*Caption ![inner](b.png)*</m>\n')
    assert.equal(result.html, figure('a.png', 'x', '', `Caption ${figure('b.png', 'inner')}`))
    assert.deepEqual(result.refs, [
      { kind: 'image', destination: 'a.png', config: 'g' },
      { kind: 'image', destination: 'b.png' },
    ])
  })

  test('a video and an audio name the media type of their extension, or of MP4 and MP3', () => {
    assert.ok(
      render('<m video>[Film](film.WebM?x=1)</m>\n').html.includes('<source src="film.WebM?x=1" type="video/webm">'),
    )
    assert.ok(render('<m audio>[Ton](ton.wav)</m>\n').html.includes('<source src="ton.wav" type="audio/wav">'))
    // an object's own names are no extension it knows
    assert.ok(render('<m video>[Film](film.constructor)</m>\n').html.includes('type="video/mp4"'))
    assert.ok(render('<m audio>[Ton](ton.toString)</m>\n').html.includes('type="audio/mpeg"'))
  })

  test('a preview is the poster of a video and the image of an audio; an embed shows none', () => {
    const video = render('<m video preview=poster.png>[Film](film.mp4)</m>\n')
    assert.ok(video.html.includes('<video controls poster="poster.png">'))
    assert.deepEqual(video.refs, [
      { kind: 'copy', destination: 'film.mp4' },
      { kind: 'copy', destination: 'poster.png' },
    ])
    const audio = render('<m audio preview=/assets/cover.png>[Ton](ton.mp3)</m>\n')
    assert.ok(
      audio.html.includes('<img src="/assets/cover.png" alt="" loading="lazy" decoding="async">\n<audio controls>'),
    )
    assert.deepEqual(audio.refs, [
      { kind: 'copy', destination: 'ton.mp3' },
      { kind: 'path', destination: '/assets/cover.png' },
    ])
    const embed = render('<m embed preview=poster.png>[Demo](https://example.com/embed)</m>\n')
    // review 2026-10-24: it was an ignored attribute, so a file the content names was neither built nor failed
    const reason = 'cannot be the preview of an embed, which shows none'
    assert.ok(embed.html.includes(`<figure>\n<!-- not built: poster.png ${reason} -->\n<iframe`))
    assert.deepEqual(embed.refs, [{ kind: 'refused', destination: 'poster.png', reason }])
    assert.deepEqual(embed.ignoredAttributes, [])
  })

  // review 2026-10-23: a second walk over the tree named files the renderer leaves out, so they were built unshown
  test('names only the files the page shows', () => {
    const titled = render('<m video>[![hidden](label.png)](film.mp4 "Titel")</m>\n')
    assert.ok(!titled.html.includes('label'))
    assert.deepEqual(titled.refs, [{ kind: 'copy', destination: 'film.mp4' }])

    const blocked = render('![x](data:image/png,AA)\\\n*Caption ![inner](b.png)*\n')
    assert.equal(blocked.html, '<!-- not built: data:image/png,AA has a scheme a file may not have (data:) -->')
    assert.deepEqual(
      blocked.refs.map((ref) => ref.kind),
      ['refused'],
    )
  })

  // review 2026-10-23: files were told apart by an extension list and by the name as written, before decoding;
  // review 2026-10-25: a page link was taken as written, so ../other/ was never checked
  test('names a file in the page directory as a bundle file and any other path as a site path, as a browser resolves it', () => {
    const result = render(
      '[a](notes) [b](missing%2epdf) [c](../other/) [d](#part) [e](?q=1) [f](/page/) [g](mailto:a@b.test)\n\n' +
        '![h](/assets%2Fmissing.png)\n\n<m video>[v](/assets/missing.mp3)</m>\n',
    )
    assert.deepEqual(result.refs, [
      { kind: 'copy', destination: 'notes' },
      { kind: 'copy', destination: 'missing%2epdf' },
      { kind: 'path', destination: '../other/' },
      { kind: 'path', destination: '/page/' },
      { kind: 'refused', destination: '/assets%2Fmissing.png', reason: 'holds an encoded / or \\ in a segment' },
      { kind: 'path', destination: '/assets/missing.mp3' },
    ])
  })

  // review 2026-10-24: an image, a medium or a download at a site path or at $… was written as it stood, unchecked
  test('names a resource at a site path as a file of the site, one at $… as a bundle file, and refuses one at …/', () => {
    const result = render(
      '![a](/missing.png)\n\n![b]($missing)\n\n<m video preview=/p.png>[v](/v.mp4)</m>\n\n<m download>[d](dir/)</m>\n\n' +
        // review 2026-10-24 (follow-up): a download in the text was taken as a link, so none of these was named
        'Get <m download>[x](/missing.pdf)</m>, <m download>[y]($missing.pdf)</m> and <m download>[z](sub/)</m>.\n',
    )
    assert.deepEqual(result.refs, [
      { kind: 'path', destination: '/missing.png' },
      { kind: 'image', destination: '$missing' },
      { kind: 'path', destination: '/v.mp4' },
      { kind: 'path', destination: '/p.png' },
      { kind: 'refused', destination: 'dir/', reason: 'names a page, not a file' },
      { kind: 'path', destination: '/missing.pdf' },
      { kind: 'copy', destination: '$missing.pdf' },
      { kind: 'refused', destination: 'sub/', reason: 'names a page, not a file' },
    ])
  })

  // a destination that leaves the page's directory is a site path, which lib checks against what the build writes
  test('names every file of the content, wherever it resolves, without a query or fragment deciding its kind', () => {
    const result = render(
      '[a](../../etc/hosts.txt) and ![b](../c.png)\n\n<m video>[v](../v.mp4)</m>\n\n[p](x.pdf?download=1#page=2)\n',
    )
    assert.deepEqual(result.refs, [
      { kind: 'path', destination: '../../etc/hosts.txt' },
      { kind: 'path', destination: '../c.png' },
      { kind: 'path', destination: '../v.mp4' },
      { kind: 'copy', destination: 'x.pdf?download=1#page=2' },
    ])
  })

  test('a bundle file without a built entry is a fault in hadley, not a silent gap', () => {
    assert.throws(() => renderDocument(parseDocument('![x](a.png)\n', options), options), /nothing built for a\.png/)
    assert.throws(() => renderDocument(parseDocument('[x](a.pdf)\n', options), options), /nothing built for a\.pdf/)
  })

  test('an unsafe data-*href on an image is dropped and refused', () => {
    const result = render('<m data-href=javascript:x lang=fr>![x](/a.png)</m>\n')
    assert.equal(result.html, '<img src="/a.png" alt="x" lang="fr">')
    assert.deepEqual(
      result.refs.filter((ref) => ref.kind === 'refused').map((ref) => ref.destination),
      ['javascript:x'],
    )
  })

  test('a data-* name hadley reserves for itself is dropped and reported', () => {
    const result = render('<m data-hadley-id=x data-ai-generated=1 lang=fr>![x](/a.png)</m>\n')
    assert.equal(result.html, '<img src="/a.png" alt="x" lang="fr">')
    assert.deepEqual(result.ignoredAttributes, ['data-hadley-id', 'data-ai-generated'])
  })

  test('hostile alt, title and data values stay text in every image path', () => {
    assert.equal(
      html('Text ![a"><script>x</script>](/a.png "t\\"><script>") Ende.'),
      '<p>Text <img src="/a.png" alt="a&quot;&gt;&lt;script&gt;x&lt;/script&gt;" title="t&quot;&gt;&lt;script&gt;"> Ende.</p>',
    )
    assert.equal(
      html('Text <m data-credit="a\\"><script>$&">![x](/a.png)</m> Ende.'),
      '<p>Text <img src="/a.png" alt="x" data-credit="a&quot;&gt;&lt;script&gt;$&amp;"> Ende.</p>',
    )
    assert.equal(html('<m data-kind="\\"><b>">Text</m>'), '<p><span data-kind="&quot;&gt;&lt;b&gt;">Text</span></p>')
    assert.equal(
      html('<m data-credit="a\\"><script>$&" lang=fr>![a](b.jpg)</m>\n'),
      figure('b.jpg', 'a', ' lang="fr" data-credit="a&quot;&gt;&lt;script&gt;$&amp;"'),
    )
    assert.equal(
      html('![a"><script>x</script>$&](b.jpg "t\\"><b>")\n'),
      figure('b.jpg', 'a&quot;&gt;&lt;script&gt;x&lt;/script&gt;$&amp;', '', 't"&gt;&lt;b&gt;'),
    )
  })

  test('an <m> image on its own line is a block image built with the config its size selects', () => {
    const block = render('<m data-size=50%>![x](bundle.jpg)</m>\n')
    assert.equal(block.html, figure('bundle.jpg', 'x', ' data-size="50%"'))
    assert.deepEqual(block.refs, [{ kind: 'image', destination: 'bundle.jpg', config: 'small' }])
  })

  test('a native-size image is copied and written at its size, or at the size its title gives', () => {
    assert.equal(
      html('<m data-size=native>![x](a.png)</m>\n'),
      '<img src="a.png" alt="x" width="8" height="8" data-size="native" loading="lazy" decoding="async">',
    )
    assert.equal(
      html('<m data-size=native>![x](a.png "640x480")</m>\n'),
      '<img src="a.png" alt="x" width="640" height="480" data-sized data-size="native" loading="lazy" decoding="async">',
    )
    assert.deepEqual(render('<m data-size=native>![x](a.png)</m>\n').refs, [{ kind: 'native', destination: 'a.png' }])
  })

  test('a bare inline image is built as a figure; <m lang> around text keeps lang', () => {
    const bare = render('Vor ![x](bundle.jpg) nach')
    assert.equal(bare.html, `<p>Vor ${figure('bundle.jpg', 'x')} nach</p>`)
    assert.deepEqual(bare.refs, [{ kind: 'image', destination: 'bundle.jpg' }])
    assert.equal(html('<m lang=fr>Text</m>'), '<p><span lang="fr">Text</span></p>')
  })

  test('renders the complete markup set', () => {
    assert.equal(
      html('*em* **strong** ~~del~~ --alt-- ++neu++ ==mark== ^hoch^ ~tief~'),
      '<p><em>em</em> <strong>strong</strong> <del>del</del> <s>alt</s> <ins>neu</ins> <mark>mark</mark> <sup>hoch</sup> <sub>tief</sub></p>',
    )
  })

  test('renders a span, an inline image and a download link', () => {
    const rendered = render(
      '<m lang=de data-kind=hinweis>Text</m> <m data-size=small>![Icon](/icon.png)</m> <m download>[PDF](datei.pdf)</m>',
    )
    assert.equal(
      rendered.html,
      '<p><span lang="de" data-kind="hinweis">Text</span> <img src="/icon.png" alt="Icon" data-size="small"> <a href="datei.pdf" download>PDF</a></p>',
    )
    assert.deepEqual(rendered.refs, [
      { kind: 'path', destination: '/icon.png' },
      { kind: 'copy', destination: 'datei.pdf' },
    ])
  })

  test('renders a bare URL as an external link', () => {
    assert.equal(
      html('Siehe https://example.com.'),
      '<p>Siehe <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>.</p>',
    )
  })
})

describe('native renderer: blocks and side channels', () => {
  // 2026-10-29 (axe, scrollable-region-focusable): a block wider than the page scrolls, and the keyboard must reach it
  test('a code block, highlighted or not, and a math block are reached by the keyboard', () => {
    assert.match(html('```\nplain\n```\n'), /^<pre tabindex="0"><code>plain/)
    assert.match(html('```ts\nconst a = 1\n```\n'), /^<pre class="shiki [^"]*" tabindex="0">/)
    assert.match(html('```math\nx^2\n```\n'), /^<pre tabindex="0"><code>x\^2/)
  })

  test('a comment block is invisible when published and a placeholder in the editor', () => {
    const source = '<!-- <b>Hinweis & intern</b> -->'
    assert.equal(html(source), '')
    assert.equal(
      extract(source, { ...options, getBlockId: () => 'kommentar-1' }).html,
      '<pre data-hadley-id="kommentar-1" class="hadley-editor-comment">&lt;!-- &lt;b&gt;Hinweis &amp; intern&lt;/b&gt; --&gt;</pre>',
    )
  })

  test('renders image, video, audio and embed', () => {
    const rendered = render(
      '<m data-size=native>![Bild](/bild.jpg "Titel")</m>\n\n<m video>[Film](film.mp4 "autoplay")</m>\n\n<m audio>[Ton](ton.mp3)</m>\n\n<m embed>[Demo](https://example.com/embed)</m>',
    )
    assert.ok(rendered.html.includes('<figure class="native" data-size="native">'))
    assert.ok(rendered.html.includes('<video autoplay muted loop playsinline controls>'))
    assert.ok(rendered.html.includes('<figcaption>Film</figcaption>'))
    assert.ok(rendered.html.includes('<audio controls>'))
    assert.ok(rendered.html.includes('<iframe src="https://example.com/embed" loading="lazy"></iframe>'))
    assert.deepEqual(rendered.refs, [
      { kind: 'path', destination: '/bild.jpg' },
      { kind: 'copy', destination: 'film.mp4' },
      { kind: 'copy', destination: 'ton.mp3' },
    ])
  })

  test('renders caption markup inside the figure', () => {
    assert.ok(
      html('<m data-size=50%>![Bild](/bild.jpg)\\\n*Eine **wichtige** Caption*</m>').includes(
        '<figcaption>Eine <strong>wichtige</strong> Caption</figcaption>',
      ),
    )
  })

  test('writes the caption of a bundle image into its figure', () => {
    assert.equal(
      html('<m data-size=small>![Bild](bild.jpg)\\\n*Die **wichtige** Bildunterschrift.*</m>'),
      figure('bild.jpg', 'Bild', ' data-size="small"', 'Die <strong>wichtige</strong> Bildunterschrift.'),
    )
  })

  test('maps containers case-insensitively, and an anonymous one to loud', () => {
    assert.equal(html('::: TLDR\nKurz.\n:::'), '<div class="tldr">\n<p>Kurz.</p>\n</div>')
    assert.equal(html(':::\nLaut.\n:::'), '<div class="loud">\n<p>Laut.</p>\n</div>')
    assert.equal(render('::: tldr\nKurz.\n:::').tldr, '<p>Kurz.</p>')
  })

  test('keeps the footnote position and the space before the reference', () => {
    assert.equal(
      html('Text. [^1]\n\n[^1]: Notiz\n\nDanach.'),
      '<p>Text. <a class="note-ref" id="note-1-ref" href="#note-1">1</a></p>\n<aside class="note" id="note-1"><a class="note-back" href="#note-1-ref">1</a>Notiz</aside>\n<p>Danach.</p>',
    )
  })

  test('renders all definition-list entries in exactly one dl', () => {
    assert.equal(html(': Begriff A\n: Begriff B'), '<dl>\n<dt>Begriff A</dt>\n<dt>Begriff B</dt>\n</dl>')
  })

  test('a block <m download> renders a real download link, with a caption as a figure', () => {
    const plain = render('<m download>[Whitepaper](paper.pdf)</m>\n')
    assert.equal(plain.html, '<p><a href="paper.pdf" download>Whitepaper</a></p>')
    assert.deepEqual(plain.refs, [{ kind: 'copy', destination: 'paper.pdf' }])

    const captioned = html('<m download>[Whitepaper](paper.pdf)\\\n*Das PDF, 2 MB*</m>\n')
    assert.ok(captioned.includes('<figure'))
    assert.ok(captioned.includes('<a href="paper.pdf" download>Whitepaper</a>'))
    assert.ok(captioned.includes('<figcaption>Das PDF, 2 MB</figcaption>'))
  })

  test('a download link may carry an image as its label', () => {
    const rendered = render('<m download>[![Cover](thumb.jpg)](paper.pdf)</m>\n')
    assert.equal(rendered.html, `<p><a href="paper.pdf" download>${figure('thumb.jpg', 'Cover')}</a></p>`)
    assert.deepEqual(rendered.refs, [
      { kind: 'copy', destination: 'paper.pdf' },
      { kind: 'image', destination: 'thumb.jpg' },
    ])
  })

  test('renders a semantic grid', () => {
    const rendered = html(':::\na\n--\nb\n:::\n')
    assert.ok(rendered.includes('<div class="grid" style="--cols:2">'))
    assert.ok(rendered.includes('<div class="grid-cell" style="--col:1">'))
    assert.ok(rendered.includes('<p>a</p>'))
    assert.ok(rendered.includes('<p>b</p>'))
  })

  test('makes recovered parse errors visible', () => {
    assert.ok(html(':::1invalid\n').includes('class="parse-error"'))
  })

  test('a table-of-contents entry is the text its heading shows, without footnote markers', () => {
    const typographic = renderBuilt('## "Zitat" -- `a--b`[^1]\n\n[^1]: Notiz\n', { ...options, typography: true })
    assert.deepEqual(typographic.toc, [{ id: 'zitat-a-b', level: 2, text: '„Zitat“ – a--b' }])
    assert.deepEqual(render('## a < b\n').toc, [{ id: 'a-b', level: 2, text: 'a < b' }])
  })

  test('a link to an unpublished page is marked, or, with unlinkUnpublished, only its text', () => {
    const source = 'Siehe [den **Entwurf**]($entwurf) hier.\n'
    const mappings = { translationMappings: { entwurf: { de: '/entwurf/' } }, unpublishedIds: new Set(['entwurf']) }
    assert.equal(
      renderBuilt(source, { ...options, ...mappings }).html,
      '<p>Siehe <a href="/entwurf/" data-link-unpublished>den <strong>Entwurf</strong></a> hier.</p>',
    )
    assert.equal(
      renderBuilt(source, { ...options, ...mappings, unlinkUnpublished: true }).html,
      '<p>Siehe den <strong>Entwurf</strong> hier.</p>',
    )
  })

  // review 2026-10-24 (Fable): a page id that named no page was written as href="$…" and published
  test('refuses a page id that names no page of its language, as a missing file', () => {
    const mappings = { translationMappings: { english: { en: '/en/english/' } }, unpublishedIds: new Set<string>() }
    const result = renderBuilt('[a]($tippfehler) [b]($english#x)\n', { ...options, ...mappings })
    assert.equal(
      result.html,
      '<p>a<!-- not built: $tippfehler names no page --> b<!-- not built: $english#x names a page with no version in de --></p>',
    )
    assert.deepEqual(result.refs, [
      { kind: 'refused', destination: '$tippfehler', reason: 'names no page' },
      { kind: 'refused', destination: '$english#x', reason: 'names a page with no version in de' },
    ])
  })
})

describe('native renderer: editor offsets', () => {
  // The block editor GETs `source.slice(start, end - 1)` and PATCHes
  // `slice(0, start) + newText + '\n' + slice(end)`; an offset that drifts by one character corrupts the file.

  // review 2026-10-24: a byte order mark hid the front matter, so a draft lost its status, and shifted every offset
  test('reads a document after its byte order mark: the front matter, and offsets into the file as it is', () => {
    const source = '\uFEFF---\ntitle: T\nstatus: draft\n---\nBody.\n\nMore.\n'
    const doc = parseDocument(source, options)
    assert.equal(doc.metadata.title, 'T')
    assert.equal(doc.metadata.status, 'draft')
    assert.deepEqual(
      doc.blocks.map((block) => source.slice(block.start, block.end)),
      ['Body.\n', 'More.\n'],
    )
    const titled = '\uFEFF# T\n\nBody.\n'
    assert.deepEqual(
      parseDocument(titled, options).blocks.map((block) => titled.slice(block.start, block.end)),
      ['Body.\n'],
    )
  })

  test('combines document blocks and footnotes in source order', () => {
    const source = 'Absatz.\n\n[^1]: Notiz\n\n## Ende\n'
    assert.deepEqual(
      blocks(source, 100).map(({ type, start, end }) => ({ type, start, end })),
      [
        { type: 'paragraph', start: 100, end: 108 },
        { type: 'footnoteDefinition', start: 109, end: 121 },
        { type: 'heading', start: 122, end: 130 },
      ],
    )
  })

  test('extract adds the front matter offset, and the title is no block', () => {
    const raw = '---\nstatus: draft\n---\n# Titel\n\nAbsatz.\n\n- Liste\n'
    let found: Array<{ start?: number; end?: number }> = []
    extract(raw, { onBlocks: (value) => (found = value) })
    assert.equal(raw.slice(found[0].start, found[0].end), 'Absatz.\n')
    assert.equal(raw.slice(found[1].start, found[1].end), '- Liste\n')
  })

  test('sets data-hadley-id on top-level blocks only', () => {
    const source = '> Zitat\n\nAbsatz.\n'
    const starts = blocks(source).map((block) => block.start!)
    const rendered = extract(source, { ...options, getBlockId: (start) => `b-${start}` }).html
    assert.ok(rendered.includes(`data-hadley-id="b-${starts[0]}"`))
    assert.ok(rendered.includes(`data-hadley-id="b-${starts[1]}"`))
    assert.equal(rendered.match(/data-hadley-id=/g)?.length, 2)
  })

  test('every editable block kind has a range that slices back to its source', () => {
    const cases = [
      'Absatz.\n',
      '## Heading\n',
      '---\n',
      '```js\nconst x = 1\n```\n',
      '- Liste\n',
      '> Zitat\n',
      '| A |\n| - |\n| B |\n',
      '::: loud\nText.\n:::\n',
      '<m data-size=native>![Bild](bild.jpg)</m>\n',
      '<m video>[Video](film.mp4)</m>\n',
      '<m audio>[Audio](ton.mp3)</m>\n',
      '<m embed>[Embed](https://example.com)</m>\n',
      '[^x]: Notiz\n',
    ]
    for (const source of cases) {
      const [block] = blocks(source)
      assert.equal(source.slice(block.start, block.end), source)
    }
  })

  test('the last block without a final newline keeps its last character', () => {
    const source = 'Letzter Absatz ohne Newline.'
    const [block] = blocks(source)
    assert.equal(block.end, source.length + 1)
    assert.equal(source.slice(block.start, block.end - 1), source)
  })

  test('an unchanged PATCH of every block reproduces the document byte for byte', () => {
    const docs = [
      '---\ntitle: T\n---\n\n# Titel\n\nEin Absatz mit **fett** und `code`.\n\n- eine Liste\n- zwei\n\n> Ein Zitat.\n\n```js\nconst x = 1\n```\n\nSchluss.\n',
      'Kein Frontmatter.\n\n   Eingerückte Fortsetzung folgt\nhier.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n',
      '::: TLDR\n- a\n- b\n:::\n\nText danach.[^n]\n\n[^n]: Note.\n',
      'Ein Absatz\n   mit eingerückter Fortsetzung\nund noch einer Zeile.\n\nDanach.\n',
      '- Punkt\n\n  | A | B |\n  | - | - |\n  | 1 | 2 |\n\n- Nächster.\n',
      '> Zitat\n> > tiefer\n\nDanach.\n',
      'Zeile eins  \nZeile zwei umbrochen.\n\n<!-- Notiz -->\n\nEnde.\n',
    ]
    for (const content of docs) {
      const found: Array<{ start: number; end: number }> = []
      extract(content, { ...options, getBlockId: () => 'id', onBlocks: (b) => found.push(...(b as never[])) })
      assert.ok(found.length > 0)
      for (const b of found) {
        const text = content.slice(b.start, b.end - 1).replace(/\n+$/, '')
        assert.equal(content.slice(0, b.start) + text + '\n' + content.slice(b.end), content)
      }
    }
  })
})

describe('native renderer: the theme’s heading', () => {
  test('writes what a heading holds; its tag and id stay the renderer’s', () => {
    const seen: unknown[] = []
    const result = renderDocument(parseDocument('## Über *uns*\n\nText.\n', {}), {
      ...options,
      heading: (heading) => {
        seen.push(heading)
        return `${heading.html}<a href="#${heading.id}">¶</a>`
      },
    })
    assert.equal(result.html.split('\n')[0], '<h2 id="über-uns">Über <em>uns</em><a href="#über-uns">¶</a></h2>')
    assert.deepEqual(seen, [{ level: 2, id: 'über-uns', html: 'Über <em>uns</em>' }])
    assert.deepEqual(result.toc, [{ id: 'über-uns', level: 2, text: 'Über uns' }])
  })
})
