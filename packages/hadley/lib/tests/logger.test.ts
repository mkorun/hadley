import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearScreen, colours, failureText, stepRow, withoutVerbose } from '../logger.ts'

// `hadley dev` on Bun erased the terminal's history (console.clear() sends ESC[3J there).
describe('clearing the terminal', () => {
  const written = (isTTY: boolean) => {
    let text = ''
    clearScreen({ isTTY, write: (more) => (text += more) })
    return text
  }

  it('clears the screen and leaves the history', () => {
    assert.equal(written(true), '\x1b[H\x1b[J')
  })

  it('writes nothing into a file or a pipe', () => {
    assert.equal(written(false), '')
  })
})

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

// 2026-11-04: on a phone of 43 columns every row with a detail broke, and the separators too
describe('a step on a wide and on a narrow terminal', () => {
  const plain = { reset: '', bold: '', check: '', error: '', muted: '', detail: '', warn: '' }
  const covers = {
    mark: '◉' as const,
    label: 'generate cover images',
    short: 'covers',
    ms: 4,
    detail: '0 new · 2 cached',
  }

  it('keeps its long name and its detail beside it on a wide one', () => {
    assert.equal(stepRow(covers, 120, plain), '  ◉  generate cover images       4 ms  0 new · 2 cached')
  })

  it('takes its short name below 70 columns', () => {
    assert.equal(stepRow(covers, 43, plain), ' ◉ covers           4 ms  0 new · 2 cached')
  })

  it('puts what does not fit beside it on the line below', () => {
    const pages = { mark: '◉' as const, label: 'render pages', ms: 69, detail: '26 pages → .hadley/publish/' }
    assert.equal(stepRow(pages, 43, plain), ' ◉ render pages    69 ms\n     26 pages → .hadley/publish/')
  })

  it('counts its warnings with what it says, and marks a failed step', () => {
    assert.equal(
      stepRow({ ...covers, warns: 2 }, 120, plain),
      '  ◉  generate cover images       4 ms  0 new · 2 cached  · 2 !',
    )
    assert.equal(stepRow({ mark: '✕', label: 'load site', ms: 3 }, 43, plain), ' ✕ load site        3 ms')
  })
})

describe('the colours a terminal takes', () => {
  it('are none outside a terminal, with NO_COLOR, or on a dumb one', () => {
    assert.equal(colours({ COLORTERM: 'truecolor' }, false), 'none')
    assert.equal(colours({ COLORTERM: 'truecolor', NO_COLOR: '1' }, true), 'none')
    assert.equal(colours({ TERM: 'dumb' }, true), 'none')
  })

  it("are hadley's own where the terminal announces 24 bits or 256 colours, else its basic ones", () => {
    assert.equal(colours({ COLORTERM: 'truecolor', TERM: 'xterm' }, true), 'truecolor')
    assert.equal(colours({ COLORTERM: '24bit' }, true), 'truecolor')
    assert.equal(colours({ TERM: 'xterm-256color' }, true), '256')
    assert.equal(colours({ TERM: 'xterm', NO_COLOR: '' }, true), 'basic')
  })
})
