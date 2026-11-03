import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { attrs } from '../../case/html.ts'
import { DrawingError, readDrawing } from '../drawing.ts'

// docs/content.md, "Drawings": what a drawing may hold comes through, prefixed; anything else names its line
const written = (svg: string, prefix = 'p') => {
  const drawing = readDrawing(svg, prefix)
  return `<svg${attrs(drawing.attrs)}>${drawing.inner}</svg>`
}
const refused = (svg: string, message: string) =>
  assert.throws(
    () => readDrawing(svg, 'p'),
    (error: unknown) => error instanceof DrawingError && error.message === message,
  )

describe('drawing: what comes through', () => {
  test('shapes, text and presentation, without namespaces, comments and the XML declaration', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- made by figures.py -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 880 100" width="880" height="100" role="img" aria-labelledby="t">
  <title id="t">Right &amp; wrong &#x2014; &lt;by method&gt;</title>
  <rect class="fig-accent" x="20" y="40" width="300" height="12" fill="#b06d00" rx="4"/>
  <text x="20" y="20" font-size="13" text-anchor="start">11–40 %</text>
</svg>
`
    assert.equal(
      written(svg),
      '<svg viewBox="0 0 880 100" width="880" height="100">\n' +
        '  <title id="p.t">Right &amp; wrong — &lt;by method&gt;</title>\n' +
        '  <rect class="fig-accent" x="20" y="40" width="300" height="12" fill="#b06d00" rx="4"></rect>\n' +
        '  <text x="20" y="20" font-size="13" text-anchor="start">11–40 %</text>\n</svg>',
    )
  })

  test('every id and every reference to one gets the prefix', () => {
    const svg =
      '<svg viewBox="0 0 10 10" aria-describedby="d"><desc id="d">x</desc><defs>' +
      '<linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>' +
      '<clipPath id="c"><rect width="5" height="5"/></clipPath><path id="dot" d="M0 0h1"/></defs>' +
      `<rect fill="url(#g)" clip-path="url( '#c' )" width="10" height="10"/><use href="#dot"/><use xlink:href="#dot" x="2"/>` +
      '<g aria-labelledby="d dot"/></svg>'
    const out = written(svg, 'drawing.a')
    assert.match(out, /^<svg viewBox="0 0 10 10" aria-describedby="drawing\.a\.d">/)
    assert.match(out, /<linearGradient id="drawing\.a\.g">/)
    assert.match(out, /fill="url\(#drawing\.a\.g\)" clip-path="url\(#drawing\.a\.c\)"/)
    assert.match(out, /<use href="#drawing\.a\.dot"><\/use><use href="#drawing\.a\.dot" x="2"><\/use>/)
    assert.match(out, /<g aria-labelledby="drawing\.a\.d drawing\.a\.dot"><\/g>/)
  })

  test('a value may call colours, arithmetic, transforms and var()', () => {
    const svg =
      '<svg><rect fill="color-mix(in oklch, var(--paper), rgb(0 0 0 / .2))" ' +
      'stroke-width="calc(1px + 2px)" transform="translate(2 3) rotate(45) skewX(10)"/></svg>'
    assert.match(written(svg), /fill="color-mix\(in oklch, var\(--paper\), rgb\(0 0 0 \/ \.2\)\)"/)
  })

  test("a value is written escaped, as the page's HTML needs it", () => {
    assert.equal(
      written(`<svg><text font-family="'A' &quot;B&quot;">a &lt;b&gt; &amp; c</text></svg>`),
      `<svg><text font-family="'A' &quot;B&quot;">a &lt;b&gt; &amp; c</text></svg>`,
    )
  })
})

describe('drawing: what stops the build', () => {
  test('elements a drawing may not hold', () => {
    refused('<svg>\n<script>alert(1)</script></svg>', 'line 2: <script>: a script a drawing may not hold')
    refused('<svg><style>text{fill:red}</style></svg>', 'line 1: <style>: a style sheet a drawing may not hold')
    refused(
      '<svg><foreignObject><p>x</p></foreignObject></svg>',
      'line 1: <foreignObject>: HTML a drawing may not hold',
    )
    refused('<svg><image href="x.png"/></svg>', 'line 1: <image>: an image a drawing may not hold')
    refused('<svg><a href="https://example.com"><text>x</text></a></svg>', 'line 1: <a>: a link a drawing may not hold')
    refused('<svg><svg/></svg>', 'line 1: <svg>: an <svg> inside the drawing, a drawing may not hold')
    refused('<svg><sodipodi:namedview/></svg>', 'line 1: <sodipodi:namedview>: an element a drawing may not hold')
    refused('<svg><metadata/></svg>', 'line 1: <metadata>: an element a drawing may not hold')
    refused('<g/>', 'line 1: <g>: a drawing is an <svg>')
  })

  test('attributes and values a drawing may not hold', () => {
    refused('<svg onload="alert(1)"/>', 'line 1: <svg> onload: an event attribute a drawing may not hold')
    refused('<svg><rect ONCLICK="x"/></svg>', 'line 1: <rect> ONCLICK: an event attribute a drawing may not hold')
    refused('<svg><rect style="fill:red"/></svg>', 'line 1: <rect> style: a style attribute a drawing may not hold')
    refused(
      '<svg><rect inkscape:label="x"/></svg>',
      'line 1: <rect> inkscape:label: an attribute a drawing may not hold',
    )
    refused(
      '<svg xmlns:inkscape="http://www.inkscape.org/"/>',
      'line 1: <svg> xmlns:inkscape: an attribute a drawing may not hold',
    )
    refused('<svg xmlns="http://example.com/"/>', 'line 1: <svg> xmlns: not the SVG namespace')
    refused('<svg><rect href="#x" id="x"/></svg>', 'line 1: <rect> href: a link; only <use> may name an #id')
    refused('<svg><use href="other.svg#x"/></svg>', 'line 1: <use> href: a link; only <use> may name an #id')
    refused('<svg><rect fill="url(https://example.com/x)"/></svg>', 'line 1: <rect> fill: a URL in its value')
    refused('<svg><rect fill="url(#g) url(x.svg)" id="g"/></svg>', 'line 1: <rect> fill: a URL in its value')
    refused('<svg><rect fill="javascript:alert(1)"/></svg>', 'line 1: <rect> fill: a URL or script in its value')
    refused(
      '<svg><rect fill="expression(alert(1))"/></svg>',
      'line 1: <rect> fill: the function expression in its value',
    )
    refused('<svg><rect fill="url(#nothing)"/></svg>', 'line 1: <rect>: #nothing names no element of the drawing')
    refused('<svg><g id="a"/><g id="a"/></svg>', 'line 1: <g>: the id "a" twice')
    refused('<svg><g id="a b"/></svg>', 'line 1: <g>: the id "a b" is not a plain name')
    // its ids hold no `.`, so that hadley's ids for it meet none of them (lib/build-files.ts, buildDrawing)
    refused('<svg><g id="a.b"/></svg>', 'line 1: <g>: the id "a.b" is not a plain name')
  })

  // review 2026-11-03 (Codex): what got through the first version
  test('a CSS escape, a function that loads, ARIA that points out of the drawing', () => {
    refused('<svg><rect fill="u\\72l(/x.svg#g)"/></svg>', 'line 1: <rect> fill: a backslash in its value')
    refused('<svg><rect id="g" fill="u\\72l(#g)"/></svg>', 'line 1: <rect> fill: a backslash in its value')
    refused(
      `<svg><rect mask="image-set('/m.png' 1x)"/></svg>`,
      'line 1: <rect> mask: the function image-set in its value',
    )
    refused('<svg><rect fill="attr(x)"/></svg>', 'line 1: <rect> fill: the function attr in its value')
    refused('<svg><rect fill="(x)"/></svg>', 'line 1: <rect> fill: the function () in its value')
    refused('<svg><g aria-owns="page"/></svg>', 'line 1: <g> aria-owns: an attribute a drawing may not hold')
    refused('<svg><g aria-controls="page"/></svg>', 'line 1: <g> aria-controls: an attribute a drawing may not hold')
    refused('<svg><g aria-labelledby="page"/></svg>', 'line 1: <g>: #page names no element of the drawing')
  })

  test('title and desc hold only text, a shape only them', () => {
    refused('<svg><title><rect/></title></svg>', 'line 1: <rect> inside <title>, which a drawing may not hold')
    refused('<svg><desc><title>x</title></desc></svg>', 'line 1: <title> inside <desc>, which a drawing may not hold')
    refused('<svg><rect><rect/></rect></svg>', 'line 1: <rect> inside <rect>, which a drawing may not hold')
    refused('<svg><text><g/></text></svg>', 'line 1: <g> inside <text>, which a drawing may not hold')
    refused(
      '<svg><linearGradient><rect/></linearGradient></svg>',
      'line 1: <rect> inside <linearGradient>, which a drawing may not hold',
    )
    assert.match(
      written('<svg><rect><title>tip</title></rect><text>a<tspan>b</tspan></text></svg>'),
      /<title>tip<\/title>/,
    )
  })

  test('what an XML file may hold and a drawing does not', () => {
    refused('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', 'line 1: a DOCTYPE')
    refused('<svg><text>&x;</text></svg>', 'line 1: the entity &x; (only &amp; &lt; &gt; &quot; &apos; and numbers)')
    // review 2026-11-03: a name an object has from its prototype is no entity either
    for (const name of ['constructor', 'toString', '__proto__'])
      refused(
        `<svg><text>&${name};</text></svg>`,
        `line 1: the entity &${name}; (only &amp; &lt; &gt; &quot; &apos; and numbers)`,
      )
    refused('<svg><text>a & b</text></svg>', 'line 1: a `&` that is no character reference')
    refused('<svg><text>&#0;</text></svg>', 'line 1: the character reference &#0; names no character')
    refused('<svg><text><![CDATA[x]]></text></svg>', 'line 1: a CDATA section')
    refused('<svg><?php echo 1 ?></svg>', 'line 1: a processing instruction (`<?…`)')
    refused('<svg><g>loose</g></svg>', 'line 1: <g>: text outside <text>, <tspan>, <title> and <desc>')
    refused('<svg><rect width=8/></svg>', 'line 1: <rect>: the value of width is not in quotes')
    refused('<svg><rect width="8" width="9"/></svg>', 'line 1: <rect>: the attribute width twice')
    refused('<svg><g></svg>', 'line 1: </svg> where </g> was expected')
    refused('<svg>\n<g>', 'line 2: <g> does not end')
    refused('<svg/><svg/>', 'line 1: something after the end of the `<svg>`')
    refused('just text', 'line 1: no element: a drawing is an `<svg>`')
  })
})
