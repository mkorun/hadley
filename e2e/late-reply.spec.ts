// An answer that comes after its field was closed (addons/editor/assets/editor.js, activeTextarea): the list of the
// bundle's files is shown nowhere, and a picture that was added goes into the bundle but into no field.
import { test, expect } from './chat-fixture.ts'
import { block, hand, openBlock, PIXEL } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Page, Route } from '@playwright/test'

/** The first request to `url` waits until released; the others go through. */
const hold = async (page: Page, url: string) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let first = true
  await page.route(url, async (route: Route) => {
    if (first) {
      first = false
      await held
    }
    await route.continue()
  })
  return release
}

test('the files of the bundle that arrive after Escape are shown nowhere', async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await dev.rebuild(() => writeFile(join(dirname(dev.source), 'pixel.png'), Buffer.from(PIXEL, 'base64')))
  const release = await hold(page, '**/__hadley/files/*')
  const field = await openBlock(page, dev.origin)
  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)
  release()
  await page.waitForTimeout(500)
  await expect(page.locator('.hadley-files')).toHaveCount(0)
  // the next field shows them
  await block(page, 'First words').click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Insert pixel.png', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('a picture whose answer comes after Cancel is in the bundle, and in no field', async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const before = await readFile(dev.source, 'utf8')
  const release = await hold(page, '**/__hadley/upload*')
  await openBlock(page, dev.origin)
  await hand(page, 'drop', [{ name: 'late.png', type: 'image/png', base64: PIXEL }])
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.hadley-editor-toolbar').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  release()
  const late = join(dirname(dev.source), 'late.png')
  await expect.poll(() => readFile(late, 'base64').catch(() => 'not yet')).toBe(PIXEL)
  await page.waitForTimeout(500)
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  await expect(page.locator('.hadley-add')).toHaveCount(0)
  expect(await readFile(dev.source, 'utf8')).toBe(before)
  // the next field offers it
  await block(page, 'First words').click({ button: 'right' })
  await expect(page.locator('.hadley-textarea')).toHaveValue('First words of the attached block.')
  await expect(page.getByRole('button', { name: 'Insert late.png', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
