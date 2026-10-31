import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { devServiceEnv, formsProgram } from '../forms-service.ts'

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

// Windows runs any file by its name (lib/platform.ts, isProgram); what it cannot run there is a directory
const windows = process.platform === 'win32'
const noProgram = (path: string): string => {
  if (windows) mkdirSync(path, { recursive: true })
  else program(path, 0o644)
  return path
}
// the name onPath looks for: on Windows with .exe
const FORMS = windows ? 'hadley-forms.exe' : 'hadley-forms'

describe('devServiceEnv', () => {
  it('keeps what belongs to production from the service of hadley dev', () => {
    const env = { ADMIN_TOKEN: 'a', HMAC_SECRET: 'b', SITE_META: 'c', NTFY_URL: 'd', NTFY_TOKEN: 'e', PATH: '/bin' }
    assert.deepEqual(devServiceEnv(env), { PATH: '/bin' })
  })
})

describe('formsProgram', () => {
  it('takes dev.forms when it is set, and stops when it cannot be run', () => {
    const configured = program(join(dir, 'own', 'forms'))
    assert.equal(formsProgram(configured, ''), configured)
    assert.throws(() => formsProgram(noProgram(join(dir, 'plain')), ''), /dev\.forms: .*plain is no program/)
    assert.throws(() => formsProgram(join(dir, 'missing'), ''), /dev\.forms: .*missing is no program/)
  })

  it('finds the first hadley-forms on the PATH that can be run, else none', () => {
    noProgram(join(dir, 'a', FORMS))
    const found = program(join(dir, 'b', FORMS))
    program(join(dir, 'c', FORMS))
    const path = [join(dir, 'a'), '', join(dir, 'b'), join(dir, 'c')].join(delimiter)
    assert.equal(formsProgram(undefined, path), found)
    assert.equal(formsProgram(undefined, join(dir, 'a')), undefined)
  })

  // review 2026-10-27: a relative directory was checked from hadley's directory and run from the site's
  it('skips a relative directory of the PATH', () => {
    const cwd = process.cwd()
    program(join(dir, 'tools', FORMS))
    process.chdir(dir)
    try {
      assert.equal(formsProgram(undefined, 'tools'), undefined)
      assert.equal(formsProgram(undefined, ['tools', join(dir, 'tools')].join(delimiter)), join(dir, 'tools', FORMS))
    } finally {
      process.chdir(cwd)
    }
  })
})
