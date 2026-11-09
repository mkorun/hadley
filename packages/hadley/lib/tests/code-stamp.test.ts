import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { codeStamp } from '../code-stamp.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-code-stamp-'))
  await mkdir(join(dir, 'lib'))
  await mkdir(join(dir, 'addons', 'editor', 'browser'), { recursive: true })
  await mkdir(join(dir, 'lib', 'tests'))
  await writeFile(join(dir, 'lib', 'a.ts'), 'a')
  await writeFile(join(dir, 'addons', 'editor', 'browser', 'b.ts'), 'b')
  await writeFile(join(dir, 'lib', 'tests', 'a.test.ts'), 't')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('the stamp of the code the dev server loads once', () => {
  it('changes with that code, and not with what is read anew for each request, nor with tests', async () => {
    const before = await codeStamp(dir)
    assert.equal(await codeStamp(dir), before)
    await writeFile(join(dir, 'addons', 'editor', 'browser', 'b.ts'), 'b, changed')
    await writeFile(join(dir, 'lib', 'tests', 'a.test.ts'), 't, changed')
    await writeFile(join(dir, 'lib', 'notes.md'), 'not code')
    assert.equal(await codeStamp(dir), before)
    await writeFile(join(dir, 'lib', 'a.ts'), 'a, changed')
    assert.notEqual(await codeStamp(dir), before)
  })

  it('changes with a file of the same size whose time changed, and with a new one', async () => {
    const before = await codeStamp(dir)
    await utimes(join(dir, 'lib', 'a.ts'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    const touched = await codeStamp(dir)
    assert.notEqual(touched, before)
    await writeFile(join(dir, 'lib', 'new.ts'), 'n')
    assert.notEqual(await codeStamp(dir), touched)
  })
})
