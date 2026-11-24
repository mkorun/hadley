import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-build-order-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const CONFIG = 'site:\n  origin: https://order.example\n  default:\n    language: en\n'

async function publish(files: Record<string, string>) {
  for (const [file, text] of Object.entries({ 'config.lima': CONFIG, ...files })) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), text)
  }
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, '..', '..', 'hadley.ts'), '--root', dir, 'deploy', '--build'],
    { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8', timeout: 30_000 },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  return result
}

describe('the steps and first failure of a build', () => {
  for (const fault of ['page', 'config'])
    it(`reports a broken layout before a fault in the ${fault}`, async () => {
      const result = await publish({
        'theme/templates/article.chase': '<b>{#if x}</b>',
        ...(fault === 'page'
          ? { 'content/notes/[n]/n.md': '---\ntitle: N\n---\nText.\n' }
          : { 'config.lima': CONFIG + 'search:\n  enabled: yes\n' }),
      })
      assert.match(result.stdout, /✕\s+compile templates/)
      assert.doesNotMatch(result.stdout, /load site/)
      assert.match(result.stderr, /theme[\\/]templates[\\/]article\.chase:1:4/)
      assert.doesNotMatch(result.stderr, /content\/|search\.enabled/)
    })

  it('reports a missing template before a page problem and marks the load-site step', async () => {
    const result = await publish({
      'theme/templates/article.chase': '<p>{ meta.title }</p>',
      'content/articles/[a]/a.md': '---\npublishFrom: 2026-01-01\ntemplate: nowhere\n---\nText.\n',
    })
    assert.match(result.stdout, /◉\s+compile templates[\s\S]*✕\s+load site/)
    assert.match(result.stderr, /the theme has no template nowhere/)
    assert.doesNotMatch(result.stderr, /title is missing/)
  })
})
