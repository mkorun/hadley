import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCoverMatrices } from '../cover-matrices.ts'

let dir: string
const css = (text: string) => {
  mkdirSync(join(dir, 'theme', 'assets', 'css'), { recursive: true })
  writeFileSync(join(dir, 'theme', 'assets', 'css', 'style.css'), text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-cover-matrices-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// 2026-11-05: mko.run's doodle filter stood in its template, and its og image would have needed the numbers again
describe('the colour matrices of cover styles', () => {
  it('are read from --cover-<style>, 20 numbers each, by style', async () => {
    css(
      ':root {\n  --cover-doodle: -0.042 0 0.042 0 0.957  -0.363 0 0.363 0 0.945  -0.984 0 0.984 0 0.918  0 0 -1.35 1.35 0;\n}',
    )
    const { doodle } = await readCoverMatrices(dir)
    assert.equal(doodle?.length, 20)
    assert.deepEqual(doodle?.slice(0, 5), [-0.042, 0, 0.042, 0, 0.957])
  })

  it('are none for a theme without them, or without a stylesheet', async () => {
    css(':root { --og-background: #102030; }')
    assert.deepEqual(await readCoverMatrices(dir), {})
    rmSync(join(dir, 'theme'), { recursive: true })
    assert.deepEqual(await readCoverMatrices(dir), {})
  })

  it('stop the build when one is not 20 numbers, with each such token named', async () => {
    css(':root { --cover-ink: 1 0 0; --cover-doodle: a b c; }')
    await assert.rejects(
      readCoverMatrices(dir),
      /--cover-ink, --cover-doodle in theme\/assets\/css\/style.css must be 20 numbers/,
    )
  })
})
