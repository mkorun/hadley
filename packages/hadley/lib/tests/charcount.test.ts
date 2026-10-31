import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { typographyText } from '../../case/index.ts'
import { highlighting, renderBuilt } from '../../case/tests/built.ts'
import { charCount } from '../render-content.ts'

before(() => highlighting('nord'))

// The character count for the VG Wort, as renderContent() computes it: the title and subtitle (typographic, as
// loadSite() makes them) and the text a reader reads, which render() returns as bodyText. Counted conservatively:
// captions, footnotes and :::nocount blocks do not count.
function count(md: string, opts: { title?: string; subtitle?: string } = {}): number {
  const r = renderBuilt(md, { bundlePath: '/content/[test]', lang: 'de', typography: true })
  const title = opts.title ? typographyText(opts.title, 'de') : undefined
  const subtitle = opts.subtitle ? typographyText(opts.subtitle, 'de') : undefined
  return charCount([title, subtitle, r.bodyText.normalize('NFC')], 'de')
}

describe('charCount: what counts', () => {
  test('an empty document counts 0', () => {
    assert.equal(count(''), 0)
  })

  test('a paragraph counts its characters', () => {
    assert.equal(count('Hallo Welt.'), 11)
  })

  test('markup adds no characters, not even a space where an element starts or ends', () => {
    assert.equal(count('*Hallo* Welt.'), 11)
    assert.equal(count('**Fett**, [Link](https://example.com).'), 11)
  })

  test('a character the HTML writes as an entity counts once', () => {
    assert.equal(count('a & b < c'), 9)
    assert.equal(count('`x && y`'), 6)
  })

  test('blocks, table cells and line breaks are separated by one space', () => {
    assert.equal(count('## Eins\n\nZwei'), 9)
    assert.equal(count('- a\n- b'), 3)
    assert.equal(count('| a | b |\n|---|---|\n| c | d |'), 7)
    assert.equal(count('a\\\nb'), 3)
  })

  test('headings and code count', () => {
    assert.equal(count('## Titel\n\n```js\nlet a\n```'), 11)
  })
})

describe('charCount: what does not count', () => {
  test('the caption of an image', () => {
    const without = count('Text.')
    assert.equal(count('Text.\n\n<m data-size=50%>![Bild](/bild.jpg)\\\n*Eine Bildunterschrift*</m>'), without)
    assert.equal(count('Text.\n\n![Bild](bild.jpg "Ein Titel als Unterschrift")'), without)
    assert.equal(count('Text.\n\n<m group=g>![a](a.jpg "Eins")</m>\n<m group=g>![b](b.jpg "Zwei")</m>'), without)
    assert.equal(count('Text ![Bild](bild.jpg "Inline-Titel") Ende.'), count('Text  Ende.'))
  })

  test('the caption of a video, an audio file, an embed and a download', () => {
    const without = count('Text.')
    assert.equal(count('Text.\n\n<m video>[Film](film.mp4)</m>'), without)
    assert.equal(count('Text.\n\n<m audio>[Ton](ton.mp3 "Titel")</m>'), without)
    assert.equal(count('Text.\n\n<m embed>[Demo](https://example.com/embed)</m>'), without)
    assert.equal(count('Text.\n\n<m download>[PDF](paper.pdf)\\\n*Das PDF, 2 MB*</m>'), count('Text.\n\nPDF'))
  })

  test('footnotes, and the markers that point to them', () => {
    assert.equal(count('Text.[^1]\n\n[^1]: Eine lange Fußnote, die nicht zählt.'), count('Text.'))
  })

  test('a :::nocount block with everything in it', () => {
    const without = count('Text.')
    assert.equal(count('Text.\n\n::: nocount\nDieser lange Disclaimer zählt nicht.\n:::'), without)
    assert.equal(count('Text.\n\n::: nocount\n# Überschrift\n\n- Punkt 1\n- Punkt 2\n\n> Blockquote\n:::'), without)
    assert.equal(count('Vor.\n\n::: nocount\nNicht zählen.\n:::\n\nNach.'), count('Vor.\n\nNach.'))
  })
})

describe('charCount: typography', () => {
  test('-- and --- count as the one dash they become', () => {
    assert.equal(count('vor -- nach'), 10)
    assert.equal(count('A --- B'), 5)
  })

  test('a typographic quote counts once', () => {
    assert.equal(count('"Text"'), 6)
  })
})

describe('charCount: title and subtitle', () => {
  test('the title and subtitle count, each after one space', () => {
    assert.equal(count('Inhalt', { title: 'Titel' }), 12)
    assert.equal(count('Inhalt', { subtitle: 'Sub' }), 10)
  })

  test('-- in the title counts as one dash', () => {
    assert.equal(count('', { title: 'A -- B' }), 5)
  })
})

describe('charCount: Unicode', () => {
  test('a character counts once however many code points it has', () => {
    assert.equal(count('Hi 👋'), 4)
    assert.equal(count('👨‍👩‍👧'), 1)
    assert.equal(count('Größe'), 5)
  })
})
