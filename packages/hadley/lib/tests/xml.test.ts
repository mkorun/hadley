import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { element, xmlDocument } from '../xml.ts'

describe('xmlDocument', () => {
  it('writes each element on its own line, indented by level', () => {
    const doc = element(
      'rss',
      [['version', '2.0']],
      element('channel', [], element('title', [], 'T'), element('atom:link', [['href', '/feed.xml']])),
    )
    assert.equal(
      xmlDocument(doc),
      '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>T</title>\n' +
        '    <atom:link href="/feed.xml"/>\n  </channel>\n</rss>\n',
    )
  })

  it('keeps hostile text and attribute values as text', () => {
    const doc = element('item', [['href', '"><x a="$&']], element('title', [], '</title><script>&amp;$&'))
    assert.equal(
      xmlDocument(doc),
      '<?xml version="1.0" encoding="UTF-8"?>\n<item href="&quot;&gt;&lt;x a=&quot;$&amp;">\n' +
        '  <title>&lt;/title&gt;&lt;script&gt;&amp;amp;$&amp;</title>\n</item>\n',
    )
  })

  it('refuses a character XML cannot hold, and what is not one element', () => {
    assert.throws(() => xmlDocument(element('title', [], 'a\u0007b')), /cannot hold the character U\+0007/)
    assert.throws(() => xmlDocument(element('a b')), /invalid XML element name/)
    assert.throws(() => xmlDocument(element('a', [['x y', '1']])), /invalid XML attribute name/)
    assert.throws(() => xmlDocument(element('a', [], 'x', element('b'))), /<a> holds text and something else/)
    assert.throws(() => xmlDocument(element('a', [], element('b'), 'x')), /<a> holds text and something else/)
    assert.throws(() => xmlDocument(element('a', [], 'x', 'y')), /<a> holds text and something else/)
  })

  it('keeps tab, line feed and carriage return', () => {
    assert.match(xmlDocument(element('d', [], 'a\tb\nc\r')), /<d>a\tb\nc\r<\/d>/)
  })
})
