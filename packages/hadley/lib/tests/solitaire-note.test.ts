import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { _isSolitaire } from '../bundles.ts'

describe('_isSolitaire', () => {
  test('accepts a normal note', () => {
    assert.equal(_isSolitaire('meine-note'), true)
  })

  test('accepts a note with several hyphens', () => {
    assert.equal(_isSolitaire('perfekt-vs-gut-genug'), true)
  })

  test('accepts a note with digits', () => {
    assert.equal(_isSolitaire('til-2026'), true)
  })

  test('ignores an UPPERCASE stem (e.g. README)', () => {
    assert.equal(_isSolitaire('README'), false)
  })

  test('ignores UPPERCASE with a hyphen (e.g. RELEASE-NOTES)', () => {
    assert.equal(_isSolitaire('RELEASE-NOTES'), false)
  })

  test('ignores a stem with a leading underscore (a private file)', () => {
    assert.equal(_isSolitaire('_draft-note'), false)
  })

  test('ignores a single underscore', () => {
    assert.equal(_isSolitaire('_'), false)
  })

  test('accepts mixed case (not pure UPPERCASE)', () => {
    assert.equal(_isSolitaire('MyNote'), true)
  })

  test('accepts a single lowercase letter', () => {
    assert.equal(_isSolitaire('a'), true)
  })
})
