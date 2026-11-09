// Undo and redo for the page (addons/editor/browser/features/undo.ts, history.ts steps; Michael, 2026-11-09): buttons
// in the pill and Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y; the editor's changes, the agent's and those from outside alike, back
// step by step and forth again, making no version; nothing to redo once a change came after an undo.
import { test, expect } from './chat-fixture.ts'
import { block, editMode, openBlock } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

const save = async (page: Page, text: string) => {
  await expect(page.locator('.hadley-textarea')).toBeFocused()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await page.keyboard.press('Control+Enter')
  await expect(block(page, text)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
}

test('undo goes back change by change, redo forth again; the buttons say what they take back', async ({
  page,
  dev,
}) => {
  const original = await readFile(dev.source, 'utf8')
  await openBlock(page, dev.origin)
  await save(page, 'First words, once.')
  await block(page, 'First words, once.').dblclick()
  await save(page, 'First words, twice.')

  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  const redo = page.getByRole('button', { name: 'Redo', exact: true })
  await expect(undo).toHaveAttribute('title', /^Undo \(Ctrl\+Z\): Editor · Block edited, /)
  await expect(redo).toBeDisabled()
  await expect(redo).toHaveAttribute('title', 'Nothing to redo')

  await undo.click()
  await expect(block(page, 'First words, once.')).toBeVisible()
  await expect(redo).toBeEnabled()
  // back and forth makes no version: the card marks the one the page stands at (Michael, 2026-11-09)
  await redo.click()
  await expect(block(page, 'First words, twice.')).toBeVisible()
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(block(page, 'First words, once.')).toBeVisible()
  await expect(redo).toBeEnabled()
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  const items = page.locator('#hadley-versions .hv-item')
  await expect(items).toHaveCount(3)
  await expect(items.nth(1)).toContainText('Current version')
  // the page as it is stands out, what undo took it away from says so (Michael, 2026-11-09)
  const rows = page.locator('#hadley-versions .hv-day li')
  await expect(rows.nth(1)).toHaveClass(/\bhv-current\b/)
  await expect(rows.nth(0)).toHaveClass(/\bhv-undone\b/)
  await expect(items.nth(0)).toContainText('Editor · Block edited · undone')
  await expect(rows.nth(2)).not.toHaveClass(/\bhv-undone\b/)
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  // Ctrl+Z, while no field is open
  await page.keyboard.press('Control+z')
  await expect.poll(() => readFile(dev.source, 'utf8')).toBe(original)
  await expect(block(page, 'First words of the attached block.')).toBeVisible()

  // forth again: Ctrl+Shift+Z, then Ctrl+Y; each once the button stands again, as the keys do what it does (a slow
  // browser in a VM pressed them before, 2026-11-09)
  await expect(redo).toBeEnabled()
  await page.keyboard.press('Control+Shift+z')
  await expect(block(page, 'First words, once.')).toBeVisible()
  await expect(redo).toBeEnabled()
  await page.keyboard.press('Control+y')
  await expect(block(page, 'First words, twice.')).toBeVisible()
  await expect(redo).toBeDisabled()
})

test('a change from outside is undone too, and a change after an undo leaves nothing to redo', async ({
  page,
  dev,
}) => {
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  const original = await readFile(dev.source, 'utf8')
  await writeFile(dev.source, original.replace('Second block.', 'Second block, from outside.'))
  await expect(block(page, 'Second block, from outside.')).toBeVisible({ timeout: 15_000 })
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toHaveAttribute('title', /^Undo \(Ctrl\+Z\): from outside, /)
  await undo.click()
  await expect(block(page, 'Second block')).toHaveText(/^Second block\.$/)

  await block(page, 'First words').dblclick()
  await save(page, 'First words, after the undo.')
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
})

test('Ctrl+Z in an open field is the field’s own', async ({ page, dev }) => {
  const field = await openBlock(page, dev.origin)
  await page.keyboard.press('End')
  await page.keyboard.type(' more')
  await page.keyboard.press('Control+z')
  await expect(field).toBeVisible()
  await page.waitForTimeout(300)
  expect(await readFile(dev.source, 'utf8')).toContain('First words of the attached block.')
})
