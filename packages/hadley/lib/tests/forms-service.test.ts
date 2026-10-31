import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { formsProgram } from '../forms-service.ts'

// Which comments service hadley dev starts (services/forms/CONTRACT.md C11).

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-forms-service-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const program = (path: string, mode = 0o755) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, mode)
  return path
}

describe('formsProgram', () => {
  it('takes dev.forms when it is set, and stops when it cannot be run', () => {
    const configured = program(join(dir, 'own', 'forms'))
    assert.equal(formsProgram(configured, ''), configured)
    assert.throws(() => formsProgram(program(join(dir, 'plain'), 0o644), ''), /dev\.forms: .*plain is no program/)
    assert.throws(() => formsProgram(join(dir, 'missing'), ''), /dev\.forms: .*missing is no program/)
  })

  it('finds the first hadley-forms on the PATH that can be run, else none', () => {
    program(join(dir, 'a', 'hadley-forms'), 0o644)
    const found = program(join(dir, 'b', 'hadley-forms'))
    program(join(dir, 'c', 'hadley-forms'))
    const path = [join(dir, 'a'), '', join(dir, 'b'), join(dir, 'c')].join(delimiter)
    assert.equal(formsProgram(undefined, path), found)
    assert.equal(formsProgram(undefined, join(dir, 'a')), undefined)
  })

  // review 2026-10-27: a relative directory was checked from hadley's directory and run from the site's
  it('skips a relative directory of the PATH', () => {
    const cwd = process.cwd()
    program(join(dir, 'tools', 'hadley-forms'))
    process.chdir(dir)
    try {
      assert.equal(formsProgram(undefined, 'tools'), undefined)
      assert.equal(
        formsProgram(undefined, ['tools', join(dir, 'tools')].join(delimiter)),
        join(dir, 'tools', 'hadley-forms'),
      )
    } finally {
      process.chdir(cwd)
    }
  })
})
