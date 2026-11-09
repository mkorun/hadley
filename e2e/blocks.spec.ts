// What the editor does with a block (addons/editor/browser/): edit and save it, cancel, move, merge and
// delete it from its menu, and refuse an edit that would change its neighbours. Written before the editor is rebuilt
// (2026-11-08), as the measure of the new one: each must hold for both.
import { test, expect } from './chat-fixture.ts'
import { block, dialogs, fromMenu, openBlock } from './editor.ts'
import { readFile } from 'node:fs/promises'

const FIRST = 'First words of the attached block.'
const SECOND = 'Second block.'

const source = (dev: { source: string }) => readFile(dev.source, 'utf8')

test('a block is edited in its field and saved with Ctrl+S, and the page shows it', async ({ page, dev }) => {
  const before = await source(dev)
  const field = await openBlock(page, dev.origin)
  await expect(field).toHaveValue(FIRST)
  await field.fill('First words, edited.')
  await page.keyboard.press('Control+s')
  await expect.poll(() => source(dev)).toBe(before.replace(FIRST, 'First words, edited.'))
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, edited.' })).toHaveCount(1)
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
})

test('Escape closes the field and saves nothing; with changes it asks first', async ({ page, dev }) => {
  const before = await source(dev)
  let field = await openBlock(page, dev.origin)
  // unchanged: closed at once
  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)
  field = await openBlock(page, dev.origin)
  await field.fill('Never saved.')
  await page.keyboard.press('Escape')
  const ask = page.getByRole('group', { name: 'Discard your changes?' })
  await expect(ask.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
  // a second Escape keeps editing
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Never saved.')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await ask.getByRole('button', { name: 'Discard', exact: true }).click()
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

test('a block is deleted at once, and the note above the pill brings it back', async ({ page, dev }) => {
  const before = await source(dev)
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'Second block', 'Delete block')
  // the blank line before the last block stays at the end of the file, as it always did (harmless; noted for later)
  await expect.poll(() => source(dev)).toBe(before.replace(`${SECOND}\n`, ''))
  const note = page.getByRole('status').filter({ hasText: 'Block deleted' })
  await expect(note).toBeVisible()
  await note.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => source(dev)).toBe(before)
  await expect(block(page, 'Second block')).toBeVisible()
})

test('an edit that would swallow the next block is refused, says why and keeps the field', async ({ page, dev }) => {
  const before = await source(dev)
  const messages = dialogs(page)
  const field = await openBlock(page, dev.origin)
  // a fence opened and never closed would take the next block into it
  await field.fill('```\nFirst words in a fence.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => messages.length).toBe(1)
  expect(messages[0]).toMatch(/outside the edited block|Parse error/)
  await expect(field).toBeVisible()
  expect(await source(dev)).toBe(before)
})

// Michael, 2026-11-09: Save only where there is something to save
test('Save is off until the text changed, and on again only while it differs; unchanged, Ctrl+Enter only closes', async ({
  page,
  dev,
}) => {
  const before = await source(dev)
  const field = await openBlock(page, dev.origin)
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()
  await expect(save).toHaveAttribute('title', 'No changes')
  await page.keyboard.type(' More.')
  await expect(save).toBeEnabled()
  await expect(save).toHaveAttribute('title', 'Save (Ctrl+Enter or Ctrl+S)')
  // back to what it was: nothing to save again
  await field.fill(FIRST)
  await expect(save).toBeDisabled()
  await page.keyboard.press('Control+Enter')
  await expect(field).toHaveCount(0)
  await page.waitForTimeout(800)
  expect(await source(dev)).toBe(before)
})
