// What the editor does with a block (addons/editor/assets/editor.js): edit and save it, cancel, move, merge and
// delete it from its menu, and refuse an edit that would change its neighbours. Written before the editor is rebuilt
// (2026-11-08), as the measure of the new one: each must hold for both.
import { test, expect } from './chat-fixture.ts'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

const FIRST = 'First words of the attached block.'
const SECOND = 'Second block.'

const editMode = async (page: Page) => {
  // the editor first: it turns edit mode back on after a reload, and a click before that would turn it off
  const toggle = page.getByRole('button', { name: 'Toggle edit mode', exact: true })
  await toggle.waitFor()
  if ((await page.locator('body.hadley-edit-mode').count()) === 0) await toggle.click()
  await expect(page.locator('body.hadley-edit-mode')).toHaveCount(1)
}

const open = async (page: Page, origin: string) => {
  await page.goto(origin + '/panel/')
  await editMode(page)
  await page.locator('[data-hadley-id]').filter({ hasText: 'First words' }).first().click({ button: 'right' })
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  return field
}

// an action of a block's menu, after the page shows the block
const fromMenu = async (page: Page, text: string, item: string) => {
  await editMode(page)
  const block = page.locator('[data-hadley-id]').filter({ hasText: text }).first()
  await block.hover()
  await block.locator('.hadley-trigger').hover()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

const source = (dev: { source: string }) => readFile(dev.source, 'utf8')

test('a block is edited in its field and saved with Ctrl+S, and the page shows it', async ({ page, dev }) => {
  const before = await source(dev)
  const field = await open(page, dev.origin)
  await expect(field).toHaveValue(FIRST)
  await field.fill('First words, edited.')
  await page.keyboard.press('Control+s')
  await expect.poll(() => source(dev)).toBe(before.replace(FIRST, 'First words, edited.'))
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, edited.' })).toHaveCount(1)
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
})

test('Escape closes the field and saves nothing', async ({ page, dev }) => {
  const before = await source(dev)
  const field = await open(page, dev.origin)
  await field.fill('Never saved.')
  await page.keyboard.press('Escape')
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  await page.waitForTimeout(800)
  expect(await source(dev)).toBe(before)
})

test('a block moves down and up again from its menu', async ({ page, dev }) => {
  const before = await source(dev)
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'First words', 'Move block down')
  await expect.poll(() => source(dev)).toBe(before.replace(`${FIRST}\n\n${SECOND}`, `${SECOND}\n\n${FIRST}`))
  // the page reloads with the new order before the next action
  const order = () =>
    page
      .locator('body')
      .innerText()
      .then((text) => text.indexOf(FIRST) > text.indexOf(SECOND))
  await expect.poll(order).toBe(true)
  await fromMenu(page, 'First words', 'Move block up')
  await expect.poll(() => source(dev)).toBe(before)
})

test('two paragraphs merge into one from the menu', async ({ page, dev }) => {
  const before = await source(dev)
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'First words', 'Merge with block below')
  await expect.poll(() => source(dev)).toBe(before.replace(`${FIRST}\n\n${SECOND}`, `${FIRST}\n${SECOND}`))
})

test('a block is deleted only once the dialog is confirmed', async ({ page, dev }) => {
  const before = await source(dev)
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'Second block', 'Delete block')
  const dialog = page.getByRole('dialog', { name: 'Delete block?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(await source(dev)).toBe(before)
  await fromMenu(page, 'Second block', 'Delete block')
  await page.getByRole('dialog', { name: 'Delete block?' }).getByRole('button', { name: 'Delete', exact: true }).click()
  // the blank line before the last block stays at the end of the file, as it always did (harmless; noted for later)
  await expect.poll(() => source(dev)).toBe(before.replace(`${SECOND}\n`, ''))
})

test('an edit that would swallow the next block is refused, says why and keeps the field', async ({ page, dev }) => {
  const before = await source(dev)
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.accept()
  })
  const field = await open(page, dev.origin)
  // a fence opened and never closed would take the next block into it
  await field.fill('```\nFirst words in a fence.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => messages.length).toBe(1)
  expect(messages[0]).toMatch(/outside the edited block|Parse error/)
  await expect(field).toBeVisible()
  expect(await source(dev)).toBe(before)
})
