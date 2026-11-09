import assert from 'node:assert/strict'
import { it } from 'node:test'
import { inlineParts, renderReply, replyParts, selectionOf, TEXT } from '../assets/chat.js'

it('has the same nonempty client texts in both languages', () => {
  assert.deepEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT.de).sort())
  for (const texts of [TEXT.en, TEXT.de]) {
    for (const value of Object.values(texts)) assert.ok(typeof value === 'string' && value.trim())
  }
})

it('keeps HTML and unsafe, relative or malformed link destinations as text', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '/local', '//host/x', 'https://']) {
    const source = `<script>alert(1)</script> [click](${href})`
    const parts = inlineParts(source)
    assert.ok(parts.every((part) => !('href' in part)))
    assert.equal(parts.map((part) => part.text).join(''), source)
  }
  assert.deepEqual(inlineParts('`<img>` [safe](https://example.org/a?q=1) [http](http://example.org/)'), [
    { code: '<img>' },
    { text: ' ' },
    { text: 'safe', href: 'https://example.org/a?q=1' },
    { text: ' ' },
    { text: 'http', href: 'http://example.org/' },
  ])
  assert.deepEqual(replyParts('First\nline\n\nSecond\n\n```html\n<script>x</script>\n```'), [
    { code: false, text: 'First\nline' },
    { code: false, text: 'Second' },
    { code: true, text: '<script>x</script>' },
  ])
})

// A tiny DOM sink with no HTML parser: an accidental innerHTML or unchecked attribute write fails this test.
class TextNode {
  children: TextNode[] = []
  textContent = ''
  href = ''
  target = ''
  rel = ''
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  ownerDocument = { createElement: (tag: string): TextNode => new TextNode(tag) }
  append(node: TextNode): void {
    this.children.push(node)
  }
  set innerHTML(_value: string) {
    assert.fail('reply used innerHTML')
  }
  setAttribute(): never {
    assert.fail('reply wrote an attribute without checking it')
  }
}

it('renders text through textContent and gives only checked links safe new tabs', () => {
  const root = new TextNode('div')
  renderReply(root, '<script>x</script> [bad](javascript:x) `code` [good](https://example.org/)\n\n```\n<b>\n```')
  const paragraph = root.children[0]
  assert.equal(paragraph.tag, 'p')
  assert.equal(paragraph.children[0].textContent, '<script>x</script> ')
  assert.equal(paragraph.children[1].textContent, '[bad](javascript:x)')
  const link = paragraph.children.find((node) => node.tag === 'a')!
  assert.equal(link.href, 'https://example.org/')
  assert.equal(link.target, '_blank')
  assert.equal(link.rel, 'noopener noreferrer')
  assert.equal(root.children[1].tag, 'pre')
  assert.equal(root.children[1].children[0].textContent, '<b>')
})

// 2026-11-05: Ctrl+Z selects the whole text it restored, and the next action then rewrote it as a selection
it('rewrites a selection, and the whole block where nothing or all of it is selected', () => {
  const field = (selectionStart: number, selectionEnd: number) => ({ selectionStart, selectionEnd, value: 'A block.' })
  assert.deepEqual(selectionOf(field(2, 7)), { start: 2, end: 7 })
  assert.equal(selectionOf(field(3, 3)), undefined)
  assert.equal(selectionOf(field(0, 8)), undefined)
})
