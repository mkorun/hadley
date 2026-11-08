// The editor on a second theme (packages/hadley/themes/punch; the fixture's site is hems'): a block is edited and
// saved, and the front matter opens from its badge, as on hems.
import { test, expect } from './chat-fixture.ts'
import { editMode, openBlock } from './editor.ts'
import { readFile } from 'node:fs/promises'

test.use({ theme: 'punch' })

test('on punch a block is edited and saved, and the front matter opens from its badge', async ({ page, dev }) => {
  const before = await readFile(dev.source, 'utf8')
  const field = await openBlock(page, dev.origin)
  await expect(field).toHaveValue('First words of the attached block.')
  await field.fill('First words, on punch.')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => readFile(dev.source, 'utf8'))
    .toBe(before.replace('First words of the attached block.', 'First words, on punch.'))
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, on punch.' })).toHaveCount(1)
  await editMode(page)
  await page.locator('.hadley-front-matter-badge').click()
  await expect(page.locator('.hadley-textarea')).toHaveValue('title: Panel\npublishFrom: 2026-01-01')
  await expect(page.locator('.hadley-fm-key').first()).toHaveText('title')
})
