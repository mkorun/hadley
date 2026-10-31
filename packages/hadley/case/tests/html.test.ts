import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { attrs, escHtml, jsonScript, pictureHtml, startTag } from '../html.ts'

describe('html serializer', () => {
  it('escapes text and attribute values', () => {
    assert.equal(escHtml('a & <b> "c"'), 'a &amp; &lt;b&gt; "c"')
    assert.equal(startTag('img', [['alt', '"><script>&']]), '<img alt="&quot;&gt;&lt;script&gt;&amp;">')
  })

  it('keeps the given order, skips undefined and writes true as a boolean attribute', () => {
    assert.equal(
      attrs([
        ['b', 1],
        ['a', undefined],
        ['download', true],
        ['c', ''],
      ]),
      ' b="1" download c=""',
    )
  })

  it('throws on a name given twice and on an invalid name', () => {
    assert.throws(
      () =>
        attrs([
          ['lang', 'de'],
          ['lang', 'fr'],
        ]),
      /attribute lang given twice/,
    )
    assert.throws(() => attrs([['a"b', 'x']]), /invalid attribute name/)
    assert.throws(() => attrs([['onclick x', 'x']]), /invalid attribute name/)
  })

  // review 2026-10-23: a title with </script> ended the JSON-LD element
  it('keeps every value inside a JSON-LD script', () => {
    const html = jsonScript({ headline: '</script><img src=x onerror=alert(1)>' })
    assert.equal(
      html,
      '<script type="application/ld+json">{\n  "headline": "\\u003c/script>\\u003cimg src=x onerror=alert(1)>"\n}\n</script>',
    )
    assert.deepEqual(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'))), {
      headline: '</script><img src=x onerror=alert(1)>',
    })
  })

  it('writes a picture with a source per format, and the img with its loading', () => {
    const picture = {
      src: 'a-4w.webp',
      width: 8,
      height: 0,
      sizes: '100vw',
      sources: [
        { type: 'image/webp', srcset: 'a-4w.webp 4w' },
        { type: 'image/avif', srcset: 'a-4w.avif 4w' },
      ],
    }
    assert.equal(
      pictureHtml(picture, '"x"', [['loading', 'eager']], [['data-ai-generated', true]]),
      '<picture data-ai-generated>\n  <source type="image/webp" srcset="a-4w.webp 4w" sizes="100vw">' +
        '\n  <source type="image/avif" srcset="a-4w.avif 4w" sizes="100vw">' +
        '\n  <img src="a-4w.webp" alt="&quot;x&quot;" width="8" loading="eager">\n</picture>',
    )
  })
})
