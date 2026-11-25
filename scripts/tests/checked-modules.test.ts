import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { slashed } from '../../packages/hadley/lib/platform.ts'
import { CHECKED as CHECKED_FOR_HTML } from '../check-html.ts'
import { CHECKED as CHECKED_FOR_WRITES } from '../check-writes.ts'

const ROOT = resolve(import.meta.dirname, '..', '..')
const BUILD = 'packages/hadley/index.ts'

/** The modules a build loads: `BUILD` and every file it names in an import by a relative path, and they in turn. */
function buildModules(): string[] {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const code = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    for (const [, path] of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"\n]+\.ts)['"]/g))
      visit(slashed(relative(ROOT, resolve(ROOT, dirname(file), path!))))
  }
  visit(BUILD)
  return [...seen].sort()
}

/** The files the patterns of a check name, as the check lists them, a new file not yet committed included. */
function filesOf(patterns: string[]): Set<string> {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...patterns], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(listed.status, 0, listed.error?.message ?? listed.stderr)
  return new Set(listed.stdout.split('\0').filter(Boolean))
}

describe('the modules a build loads', () => {
  const modules = buildModules()

  it('are found from the build by its imports, the comments template of an addon among them', () => {
    assert.ok(modules.includes('packages/hadley/lib/load-site.ts'))
    assert.ok(modules.includes('packages/hadley/addons/forms/render.ts'))
  })

  for (const [check, patterns] of [
    ['scripts/check-html.ts', CHECKED_FOR_HTML],
    ['scripts/check-writes.ts', CHECKED_FOR_WRITES],
  ] as const)
    it(`are all among those ${check} checks`, () => {
      const checked = filesOf(patterns)
      assert.deepEqual(
        modules.filter((file) => !checked.has(file)),
        [],
      )
    })
})
