import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { wordIn } from '../browser/core/word.ts'

describe('the word a double click opened a block on', () => {
  it('is found as a whole word in the Markdown, past its marks', () => {
    assert.equal(wordIn('Some **bold** words.', { word: 'bold', at: 0.3 }), 7)
    assert.equal(wordIn('A [link](https://x.org) here.', { word: 'link', at: 0.2 }), 3)
    // part of a longer word is not it
    assert.equal(wordIn('wordy word', { word: 'word', at: 0 }), 6)
    assert.equal(wordIn('nothing like it', { word: 'absent', at: 0.5 }), -1)
  })

  it('of several, the one at about the same place in the text', () => {
    const source = 'the cat sat on the mat by the door'
    assert.equal(wordIn(source, { word: 'the', at: 0 }), 0)
    assert.equal(wordIn(source, { word: 'the', at: 0.5 }), 15)
    assert.equal(wordIn(source, { word: 'the', at: 0.9 }), 26)
  })
})
