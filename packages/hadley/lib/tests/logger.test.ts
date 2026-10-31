import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failureText, withoutVerbose } from '../logger.ts'

// review 2026-10-28 (C.5): a failure showed hadley's own source and stack around the message, and the site's paths
// absolute. Not on a terminal, failureText writes no colour.
describe('a failure as the command line writes it', () => {
  it('names the files relative to the site, the lines about one under it, and a heading on its own', () => {
    const error = new Error('cannot publish:\n/s/content/a.md: one\n/s/content/a.md: two\n/s/content/b.md: three')
    assert.equal(
      failureText(error, '/s'),
      '\n  cannot publish\n\n  content/a.md\n     one\n     two\n  content/b.md\n     three\n',
    )
  })

  it("sets galley's message under the file and position it names, with its source", () => {
    const error = new Error(
      '[galley:G2001] /s/theme/templates/a.chase:3:9 (line 3, col 9): Closing tag {/if} without matching opening tag\n<p>{/if}\n   ^',
    )
    assert.equal(
      failureText(error, '/s'),
      '\n  theme/templates/a.chase:3:9\n     Closing tag {/if} without matching opening tag (G2001)\n  <p>{/if}\n     ^\n',
    )
  })

  it('writes any other message as it is', () => {
    assert.equal(
      failureText(new Error('no site here: no config.lima in /x')),
      '\n  no site here: no config.lima in /x\n',
    )
  })

  it('quotes the line a place names, once its messages are written', () => {
    const site = mkdtempSync(join(tmpdir(), 'hadley-logger-test-'))
    try {
      mkdirSync(join(site, 'content'))
      writeFileSync(join(site, 'content', 'a.md'), '---\ncolour: red\n---\n')
      const error = new Error(`cannot publish:\n${site}/content/a.md:2: one\n${site}/content/a.md:2: two`)
      assert.equal(
        failureText(error, site),
        '\n  cannot publish\n\n  content/a.md:2\n     one\n     two\n     2 │ colour: red\n',
      )
    } finally {
      rmSync(site, { recursive: true, force: true })
    }
  })
})

// review 2026-10-29 (documentation): `hadley --verbose version` took --verbose for the command
describe('the verbose options', () => {
  it('leave a command its own arguments, wherever they stand', () => {
    assert.deepEqual(withoutVerbose(['--verbose', 'build', '--root', 'site', '-v']), ['build', '--root', 'site'])
    assert.deepEqual(withoutVerbose(['init', 'my-site']), ['init', 'my-site'])
  })
})
