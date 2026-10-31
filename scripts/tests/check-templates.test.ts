import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../check-templates.ts'

describe('check-templates', () => {
  let dir: string
  const template = (site: string, file: string, text: string) => {
    mkdirSync(join(dir, site, 'theme', 'templates', 'partials'), { recursive: true })
    writeFileSync(join(dir, site, 'theme', 'templates', file), text)
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hadley-check-templates-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('finds a {@raw} the build would refuse in any layout or partial, also one nothing includes', () => {
    template('a', 'page.chase', '{@raw html.markup}')
    assert.equal(main(dir, join(dir, 'none')), 0)
    template('a', 'partials/unused.sort', '{@raw comment.textHtml}')
    const log = console.log
    const lines: string[] = []
    console.log = (line: string) => lines.push(line)
    try {
      assert.equal(main(dir, join(dir, 'none')), 1)
    } finally {
      console.log = log
    }
    assert.match(lines.join('\n'), /partials\/unused\.sort: \{@raw comment\.textHtml\} writes a value as HTML/)
  })

  it('checks the themes too, and has nothing to check without sites and themes', () => {
    mkdirSync(join(dir, 'themes', 'hems', 'templates'), { recursive: true })
    writeFileSync(join(dir, 'themes', 'hems', 'templates', 'page.chase'), '{@raw meta.title}')
    const log = console.log
    console.log = () => {}
    try {
      assert.equal(main(join(dir, 'none'), join(dir, 'themes')), 1)
    } finally {
      console.log = log
    }
    assert.equal(main(join(dir, 'none'), join(dir, 'none')), 0)
  })
})
