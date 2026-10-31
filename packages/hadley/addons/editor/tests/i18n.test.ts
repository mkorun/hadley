import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLang } from '../i18n.ts'

// The editor's server texts are German for a German page and English for every other (i18n.ts).

describe('resolveLang', () => {
  it('takes German for de and English for anything else', () => {
    assert.equal(resolveLang('de'), 'de')
    for (const value of ['en', 'fr', '', null, undefined]) assert.equal(resolveLang(value), 'en')
  })
})
