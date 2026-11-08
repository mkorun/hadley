// The server answers 500, or the connection fails (addons/editor/assets/editor.js): what the author sees when a block
// is opened, saved, moved or deleted. Each is a dialog that says what failed, the file stays as it was, and the field
// stays open with its text. The cases marked `today:` show what the page does then, as it is.
import { test, expect } from './chat-fixture.ts'
import { block, dialogs, editMode, fromMenu, openBlock } from './editor.ts'
import { readFile } from 'node:fs/promises'
import type { Route } from '@playwright/test'

const ways = {
  'the server answers 500': {
    fail: (route: Route) => route.fulfill({ status: 500, json: { error: 'Server fault' } }),
    open: 'Failed to load block (500).',
    save: 'Error saving (500):\nServer fault',
    move: 'Error moving (500):\nServer fault',
    delete: 'Error deleting (500):\nServer fault',
  },
  'the connection fails': {
    fail: (route: Route) => route.abort('connectionrefused'),
    open: 'Connection to the development server failed.',
    save: 'Connection to the server failed. Please try again.',
    move: 'Connection to the server failed.',
    delete: 'Connection to the server failed.',
  },
}

for (const [name, way] of Object.entries(ways)) {
  test.describe(name, () => {
    test('on opening a block: the message, and no field', async ({ page, dev }) => {
      const messages = dialogs(page)
      await page.route('**/__hadley/block/*', way.fail)
      await page.goto(dev.origin + '/panel/')
      await editMode(page)
      await block(page, 'First words').click({ button: 'right' })
      await expect.poll(() => messages).toEqual([way.open])
      await expect(page.locator('.hadley-textarea')).toHaveCount(0)
      // the next try reaches the server
      await page.unroute('**/__hadley/block/*')
      await block(page, 'First words').click({ button: 'right' })
      await expect(page.locator('.hadley-textarea')).toHaveValue('First words of the attached block.')
    })

    test('on saving: the message, the field with its text, and the file as it was', async ({ page, dev }) => {
      const before = await readFile(dev.source, 'utf8')
      const messages = dialogs(page)
      const field = await openBlock(page, dev.origin)
      await page.route('**/__hadley/patch*', way.fail)
      await field.fill('First words, not saved.')
      await page.keyboard.press('Control+s')
      await expect.poll(() => messages).toEqual([way.save])
      await expect(field).toHaveValue('First words, not saved.')
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
      expect(await readFile(dev.source, 'utf8')).toBe(before)
      await page.unroute('**/__hadley/patch*')
      await page.keyboard.press('Control+s')
      await expect
        .poll(() => readFile(dev.source, 'utf8'))
        .toBe(before.replace('First words of the attached block.', 'First words, not saved.'))
    })

    test('on moving: the message, and the file as it was', async ({ page, dev }) => {
      const before = await readFile(dev.source, 'utf8')
      const messages = dialogs(page)
      await page.route('**/__hadley/move*', way.fail)
      await page.goto(dev.origin + '/panel/')
      await fromMenu(page, 'First words', 'Move block down')
      await expect.poll(() => messages).toEqual([way.move])
      await page.waitForTimeout(500)
      expect(await readFile(dev.source, 'utf8')).toBe(before)
      // today: the block stays where its animation took it, below the second, until the page is reloaded
      const first = await block(page, 'First words').boundingBox()
      const second = await block(page, 'Second block').boundingBox()
      expect(first!.y).toBeGreaterThan(second!.y)
      await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
    })

    test('on deleting: the message, and the file as it was', async ({ page, dev }) => {
      const before = await readFile(dev.source, 'utf8')
      const messages = dialogs(page)
      await page.route('**/__hadley/delete*', way.fail)
      await page.goto(dev.origin + '/panel/')
      await fromMenu(page, 'Second block', 'Delete block')
      await page
        .getByRole('dialog', { name: 'Delete block?' })
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await expect.poll(() => messages).toEqual([way.delete])
      await page.waitForTimeout(500)
      expect(await readFile(dev.source, 'utf8')).toBe(before)
      // today: the block stays faded out, as its animation left it, until the page is reloaded
      await expect(block(page, 'Second block')).toHaveCSS('opacity', '0')
      await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
    })
  })
}

test('a save the server never answers: Save waits, Cancel still closes the field', async ({ page, dev }) => {
  const before = await readFile(dev.source, 'utf8')
  const messages = dialogs(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/__hadley/patch*', async (route) => {
    await held
    await route.abort('connectionrefused')
  })
  const field = await openBlock(page, dev.origin)
  await field.fill('First words, never answered.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.waitForTimeout(500)
  await expect(field).toHaveValue('First words, never answered.')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(field).toHaveCount(0)
  release()
  await page.waitForTimeout(500)
  // today: the answer that comes to a closed field still shows its message
  expect(messages).toEqual(['Connection to the server failed. Please try again.'])
  expect(await readFile(dev.source, 'utf8')).toBe(before)
})
