import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { FILES, forNode, forNpm, manifest, repositoryUrl } from '../pack.ts'
import { STARTERS, THEMES } from '../../packages/hadley/lib/init.ts'

// What the published package differs in from packages/hadley (scripts/pack.ts): its command line is the compiled one,
// and it starts with Node.js.

describe('the published package', () => {
  it('names the compiled command line and keeps the rest of the manifest', () => {
    const source = {
      name: '@mkorun/hadley',
      version: '0.1.0',
      bin: { hadley: './hadley.ts' },
      engines: { node: '>=24' },
    }
    assert.deepEqual(manifest(source), { ...source, bin: { hadley: './hadley.js' } })
  })

  // review 2026-10-29 (documentation): the package lacked the starters and themes `hadley init` reads
  it('carries the files hadley reads beside its sources', () => {
    for (const dir of [STARTERS, THEMES]) assert.ok(FILES.includes(basename(dir)), basename(dir))
    for (const path of FILES) assert.ok(existsSync(join(import.meta.dirname, '../../packages/hadley', path)), path)
  })

  it('starts its command line with Node.js, whatever interpreter the source named', () => {
    assert.equal(forNode('#!/usr/bin/env bun\nimport x from "y"\n'), '#!/usr/bin/env node\nimport x from "y"\n')
    assert.equal(forNode('import x from "y"\n'), 'import x from "y"\n')
  })

  it('makes the relative links of its README lead to the repository, as npm shows it alone', () => {
    const repository = 'https://github.com/mkorun/hadley'
    assert.equal(
      forNpm(
        '[Getting started](docs/getting-started.md), [ISC](LICENSE), [x](docs/config.md#fields-of-a-page)',
        repository,
      ),
      '[Getting started](https://github.com/mkorun/hadley/blob/main/docs/getting-started.md), ' +
        '[ISC](https://github.com/mkorun/hadley/blob/main/LICENSE), ' +
        '[x](https://github.com/mkorun/hadley/blob/main/docs/config.md#fields-of-a-page)',
    )
    const kept = '[Markanto](https://markanto.org), [up](#quick-start), [feed](/feed.xml), [mail](mailto:a@b.example)'
    assert.equal(forNpm(kept, repository), kept)
  })

  it('reads its repository on GitHub from the manifest', () => {
    assert.equal(
      repositoryUrl({ repository: { url: 'git+https://github.com/mkorun/hadley.git' } }),
      'https://github.com/mkorun/hadley',
    )
    assert.throws(() => repositoryUrl({ repository: { url: 'https://gitlab.com/x/y' } }), /no repository on GitHub/)
  })
})
