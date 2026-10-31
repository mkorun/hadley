import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLogoPath } from '../resolve-logo-path.ts'

let tmpDir: string
let siteDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'hadley-logo-test-'))
  siteDir = join(tmpDir, 'site')
  await mkdir(join(siteDir, 'theme', 'assets', 'images'), { recursive: true })
  await mkdir(join(siteDir, 'theme', 'assets', 'css'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('resolveLogoPath', () => {
  test('returns undefined when nothing exists', async () => {
    assert.equal(await resolveLogoPath(siteDir), undefined)
  })

  test('finds logo.svg by the directory convention', async () => {
    const logo = join(siteDir, 'theme', 'assets', 'images', 'logo.svg')
    await writeFile(logo, '<svg/>')
    assert.equal(await resolveLogoPath(siteDir), logo)
  })

  test('falls back to logo.png when there is no .svg', async () => {
    const logo = join(siteDir, 'theme', 'assets', 'images', 'logo.png')
    await writeFile(logo, 'fake-png')
    assert.equal(await resolveLogoPath(siteDir), logo)
  })

  test('the --og-logo token takes precedence over the convention', async () => {
    await writeFile(join(siteDir, 'theme', 'assets', 'images', 'logo.svg'), '<svg/>')
    const ogLogo = join(siteDir, 'theme', 'assets', 'images', 'logo-og.svg')
    await writeFile(ogLogo, '<svg/>')
    await writeFile(
      join(siteDir, 'theme', 'assets', 'css', 'style.css'),
      `:root {\n\t--og-logo: url('/assets/images/logo-og.svg');\n}\n`,
    )
    assert.equal(await resolveLogoPath(siteDir), ogLogo)
  })

  test('falls back to the convention when --og-logo points to a missing file', async () => {
    const logo = join(siteDir, 'theme', 'assets', 'images', 'logo.svg')
    await writeFile(logo, '<svg/>')
    await writeFile(
      join(siteDir, 'theme', 'assets', 'css', 'style.css'),
      `:root {\n\t--og-logo: url('/assets/images/nicht-da.svg');\n}\n`,
    )
    const warn = mock.method(console, 'warn', () => {})
    assert.equal(await resolveLogoPath(siteDir), logo)
    assert.ok(warn.mock.callCount() > 0)
    warn.mock.restore()
  })

  test('keeps the existing behaviour without style.css (no crash, no warning needed)', async () => {
    const logo = join(siteDir, 'theme', 'assets', 'images', 'logo.svg')
    await writeFile(logo, '<svg/>')
    assert.equal(await resolveLogoPath(siteDir), logo)
  })
})
