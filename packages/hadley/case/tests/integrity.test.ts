import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { checkOnlyEditedBlockChanged } from '../integrity.ts'

describe('checkOnlyEditedBlockChanged', () => {
  // Offsets below are the real parser's block ranges for
  // 'Alpha.\n\nBravo.\n\nCharlie.\n' (Alpha [0,6), Bravo [8,14), Charlie [16,24)),
  // with `edit` in the BlockToken convention plugin.ts actually passes
  // (`end` includes the block's own trailing \n, i.e. raw end + 1).

  test('an isolated edit inside one block passes', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\nCharlie.\n'
    const newDoc = 'Alpha.\n\nBravo and more.\n\nCharlie.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.deepEqual(result, { ok: true })
  })

  test('a length-changing edit shifts later blocks correctly', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\nCharlie.\n'
    const newDoc = 'Alpha.\n\nB.\n\nCharlie.\n' // shrinks instead of grows
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.deepEqual(result, { ok: true })
  })

  test('a change to content outside the edited block is caught', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\nCharlie.\n'
    // Same edit to "Bravo.", but the block after it reads differently too —
    // simulating something changing content this patch never declared touching.
    const newDoc = 'Alpha.\n\nBravo and more.\n\nDelta.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.equal(result.ok, false)
    assert.deepEqual(result.mismatch, { start: 16, end: 24 })
  })

  test('a change to content BEFORE the edited block is caught', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\nCharlie.\n'
    const newDoc = 'Zulu.\n\nBravo and more.\n\nCharlie.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.equal(result.ok, false)
    assert.deepEqual(result.mismatch, { start: 0, end: 6 })
  })

  test('an extra block appearing outside the edit is caught even with no pairwise mismatch', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\nCharlie.\n'
    // "Charlie." still matches at its shifted position, but an unrelated
    // paragraph now also exists after it — nothing in the pairwise old→new
    // walk would notice on its own; only the count check catches this.
    const newDoc = 'Alpha.\n\nBravo and more.\n\nCharlie.\n\nDelta.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.equal(result.ok, false)
  })

  test('a footnote definition outside the edit is compared too', () => {
    const oldDoc = 'Alpha.\n\nBravo.\n\n[^n]: a note\n'
    const newDoc = 'Alpha.\n\nBravo and more.\n\n[^n]: a DIFFERENT note\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 8, end: 15 })
    assert.equal(result.ok, false)
  })

  // A pre-existing, unrelated error elsewhere no longer stops this check from
  // running (plugin.ts's gate now only blocks on errors overlapping the
  // edited block) — these compare against the RecoveryDocument/ErrorBlock
  // instead of a valid Document. Offsets: real parser ranges for
  // 'Alpha.\n\n<m>kaputt\n\nCharlie.\n' — Alpha [0,6), errorBlock [8,17), Charlie [19,27).

  test('a pre-existing error elsewhere does not block the check when nothing else changed', () => {
    const oldDoc = 'Alpha.\n\n<m>kaputt\n\nCharlie.\n'
    const newDoc = 'Alpha edited.\n\n<m>kaputt\n\nCharlie.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 0, end: 7 })
    assert.deepEqual(result, { ok: true })
  })

  test('still catches drift in a real block even with a pre-existing error elsewhere', () => {
    const oldDoc = 'Alpha.\n\n<m>kaputt\n\nCharlie.\n'
    // Two independent things change here (the edit AND "Charlie"→"Delta"), which
    // a real single-block patch never does — just assert detection, not which of
    // the two outside blocks gets blamed first.
    const newDoc = 'Alpha edited.\n\n<m>kaputt\n\nDelta.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 0, end: 7 })
    assert.equal(result.ok, false)
  })

  test('catches the ErrorBlock itself changing outside the edit', () => {
    const oldDoc = 'Alpha.\n\n<m>kaputt\n\nCharlie.\n'
    const newDoc = 'Alpha edited.\n\n<m>anders\n\nCharlie.\n'
    const result = checkOnlyEditedBlockChanged(oldDoc, newDoc, { start: 0, end: 7 })
    assert.equal(result.ok, false)
  })
})
