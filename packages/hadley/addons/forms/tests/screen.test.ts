import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { messagesFor } from '../messages.ts'
import { displayWidth, screen, truncate, wrap, type View } from '../screen.ts'

// What hadley comments shows of a comment (screen.ts).

const view = (over: Partial<View> = {}, entry: Partial<View['entry']> = {}): View => ({
  entry: {
    id: '1',
    article_id: 'artikel',
    language_version: 'de',
    parent_comment_id: null,
    name: 'Nora',
    email: 'nora@example.org',
    submitted_at: '2026-10-27T11:30:00Z',
    text: 'Ein Text.',
    notify: false,
    ...entry,
  },
  position: 1,
  total: 3,
  site: 'example.org',
  articleTitle: 'Ein Titel',
  note: null,
  reply: null,
  mailWritten: false,
  language: 'de',
  ...over,
})

describe('the screen', () => {
  it('measures emoji and wide characters as two columns, combining marks as none', () => {
    assert.equal(displayWidth('abc'), 3)
    assert.equal(displayWidth('Nöra'), 4)
    assert.equal(displayWidth('é'), 1)
    assert.equal(displayWidth('🦊'), 2)
    assert.equal(displayWidth('漢字'), 4)
    assert.equal(truncate('abcdef', 4), 'abc…')
    assert.equal(truncate('🦊🦊🦊', 4), '🦊…')
  })

  it('wraps at spaces, breaks a word longer than the line, and keeps paragraphs', () => {
    assert.deepEqual(wrap('eins zwei drei', 9), ['eins zwei', 'drei'])
    assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij'])
    assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b'])
  })

  it('keeps every line within the width, whatever the visitor wrote', () => {
    const long = 'x'.repeat(300)
    for (const width of [40, 61, 80, 120]) {
      const shown = screen(
        view({ articleTitle: long }, { name: long, email: `${long}@example.org`, text: long }),
        messagesFor('de'),
        width,
        false,
      )
      for (const line of shown.split('\n'))
        assert.ok(displayWidth(line) <= Math.min(width, 100), `${displayWidth(line)} > ${width}: ${line}`)
    }
  })

  it("shows a visitor's control characters as the replacement character, never as an escape sequence", () => {
    const shown = screen(view({}, { name: 'N\u001b[2J', text: 'T\u009b2J\u0007' }), messagesFor('en'), 80, true)
    assert.doesNotMatch(shown.replace(/\x1b\[[0-9;]*m/g, ''), /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    assert.match(shown, /N�\[2J/)
  })

  it('shows the address beside the name only when the visitor gave one', () => {
    const sender = (v: View) => screen(v, messagesFor('en'), 80, false).split('\n')[3]!
    assert.match(sender(view()), /Nora <nora@example\.org>/)
    assert.doesNotMatch(sender(view({}, { email: '' })), /</)
  })

  it('offers the mail key only for a visitor who asked to be notified and has no mail yet', () => {
    const keys = (v: View) => screen(v, messagesFor('en'), 100, false).split('\n').at(-1)!
    assert.doesNotMatch(keys(view()), /m mail/)
    assert.match(keys(view({}, { notify: true })), /m mail/)
    assert.doesNotMatch(keys(view({ mailWritten: true }, { notify: true })), /m mail/)
  })

  it('speaks the language of the site where there is a translation, else English', () => {
    assert.equal(messagesFor('de').note, 'Notiz')
    assert.equal(messagesFor('fr').note, 'Note')
    assert.equal(messagesFor(undefined).note, 'Note')
  })
})
