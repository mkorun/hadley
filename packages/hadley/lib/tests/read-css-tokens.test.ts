import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCssTokens } from '../read-css-tokens.ts'

let siteDir: string

beforeEach(() => {
  siteDir = mkdtempSync(join(tmpdir(), 'hadley-css-tokens-test-'))
  mkdirSync(join(siteDir, 'theme', 'assets', 'css'), { recursive: true })
})

afterEach(() => {
  rmSync(siteDir, { recursive: true, force: true })
})

const css = (text: string) => writeFileSync(join(siteDir, 'theme', 'assets', 'css', 'style.css'), text)

describe('readCssTokens', () => {
  it('reads a token by its exact name; the first declaration counts', async () => {
    css(':root {\n  --x--og-accent: red;\n  --og-accent: #c00 ;\n  --og-accent: blue;\n}\n.a { --og-logo: x; }')
    assert.deepEqual(await readCssTokens(siteDir, ['--og-accent', '--og-logo']), {
      '--og-accent': '#c00',
      '--og-logo': undefined,
    })
  })

  it('returns no tokens without a stylesheet', async () => {
    rmSync(join(siteDir, 'theme'), { recursive: true })
    assert.deepEqual(await readCssTokens(siteDir, ['--og-accent']), {})
  })
})
