// The versions of a page, the time machine (addons/editor/history.ts, browser/features/versions.ts): an edit is a
// version, an earlier one shows what restoring it would change, a name stays, and restoring brings the page back and
// keeps the one it left, so that going forth again is as easy.
import { test, expect } from './chat-fixture.ts'
import { openBlock } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'

const FIRST = 'First words of the attached block.'

test('an edit is a version; an earlier one is compared, named and restored, and the page comes back', async ({
  page,
  dev,
}) => {
  const original = await readFile(dev.source, 'utf8')
  const field = await openBlock(page, dev.origin)
  await field.fill('First words, changed.')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, changed.' })).toHaveCount(1)

  const toggle = page.getByRole('button', { name: 'Versions of this page', exact: true })
  await toggle.click()
  const card = page.locator('#hadley-versions')
  await expect(card).toBeVisible()
  const items = card.locator('.hv-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Current version')
  await expect(items.nth(1)).toContainText('from outside')

  // what restoring the earlier one would change: the line now out, the line then in
  await items.nth(1).click()
  const diff = card.locator('.hv-diff')
  await expect(diff.locator('.hv-del')).toHaveText('− First words, changed.')
  await expect(diff.locator('.hv-add')).toHaveText(`+ ${FIRST}`)

  // a name stays with the version
  await card.getByRole('button', { name: 'Name', exact: true }).click()
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill('before the change')
  await page.keyboard.press('Enter')
  await expect(items.nth(1)).toContainText('before the change')

  await items.nth(1).click()
  await card.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Restore this version?')
  await page.getByRole('button', { name: 'Restore', exact: true }).last().click()
  await expect.poll(() => readFile(dev.source, 'utf8')).toBe(original)
  await expect(page.locator('[data-hadley-id]').filter({ hasText: FIRST })).toHaveCount(1)

  // after the reload: the restored version is current, the one it left is still there
  await page.getByRole('button', { name: 'Versions of this page', exact: true }).click()
  const after = page.locator('#hadley-versions .hv-item')
  await expect(after).toHaveCount(3)
  await expect(after.nth(0)).toContainText('Current version')
  await expect(after.nth(1)).toContainText('Editor · Block edited')
  await expect(after.nth(2)).toContainText('before the change')
})

test('the versions button stands in the pill in edit mode only, and Escape closes its card', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  const toggle = page.getByRole('button', { name: 'Versions of this page', exact: true })
  await expect(toggle).toBeHidden()
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await toggle.click()
  await expect(page.locator('#hadley-versions')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#hadley-versions')).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

// Michael, 2026-11-09: a change made to the file directly, by hand or by an agent, while the dev server runs
test('a change to the file made outside the editor is a version too', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  const original = await readFile(dev.source, 'utf8')
  await writeFile(dev.source, original.replace(FIRST, 'First words, from another program.'))
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'from another program' })).toHaveCount(1, {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await page.getByRole('button', { name: 'Versions of this page', exact: true }).click()
  const items = page.locator('#hadley-versions .hv-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Current version')
  await items.nth(1).click()
  await expect(page.locator('#hadley-versions .hv-del')).toHaveText('− First words, from another program.')
})
