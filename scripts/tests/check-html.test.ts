import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { htmlFindings } from '../check-html.ts'

describe('htmlFindings', () => {
  it('reports an attribute value written by interpolation', () => {
    assert.deepEqual(htmlFindings(['const a = 1', 'html += `<img alt="${alt}">`'].join('\n')), [
      '2: attribute value by interpolation; use startTag',
    ])
  })

  it('reports single quotes, and an escaper call too', () => {
    assert.deepEqual(htmlFindings("html += `<img alt='${alt}'>`"), [
      '1: attribute value by interpolation; use startTag',
    ])
    assert.deepEqual(htmlFindings('xml += `<atom:link href="${escapeXml(origin)}/feed.xml" />`'), [
      '1: attribute value by interpolation; use startTag',
    ])
  })

  it('reports a template literal as replacement, for replaceAll too', () => {
    assert.deepEqual(htmlFindings('markup = markup.replace(marker, `<figure>${html}</figure>`)'), [
      '1: template literal as replacement; use a function',
    ])
    assert.deepEqual(htmlFindings('html = html.replaceAll(`/${orig}`, `/${fp}`)'), [
      '1: template literal as replacement; use a function',
    ])
  })

  it('accepts startTag, a function replacement and a plain replacement string', () => {
    const text = [
      "html += startTag('img', [['alt', alt]])",
      'markup.replace(MARKER, (marker) => html.get(marker) ?? marker)',
      "html.replace(/<p><\\/p>/g, '')",
    ].join('\n')
    assert.deepEqual(htmlFindings(text), [])
  })
})
