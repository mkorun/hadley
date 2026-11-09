import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spotFor } from '../browser/core/spot.ts'

describe('where a file goes in at the caret', () => {
  it('goes after an image or a link the caret stands in, never into it', () => {
    const text = 'Before ![](a.png) after'
    // in the alt text, as after a picture was put in
    assert.equal(spotFor(text, 9), 17)
    assert.equal(spotFor(text, 14), 17)
    assert.equal(spotFor('A [link](x.txt).', 4), 15)
  })

  it('stays where the caret is outside of one, at its edges too', () => {
    const text = 'Before ![](a.png) after'
    assert.equal(spotFor(text, 0), 0)
    assert.equal(spotFor(text, 7), 7)
    assert.equal(spotFor(text, 17), 17)
    assert.equal(spotFor('no links here', 5), 5)
  })
})
