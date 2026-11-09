// The versions of a page, the time machine (addons/editor/history.ts, browser/features/versions/): an edit is a
// version, an earlier one opens in its row and shows what restoring it would change, word by word; a kept one stays,
// one can be deleted, every unnamed one at once, and restoring brings the page back and keeps the one it left.
import { test, expect } from './chat-fixture.ts'
import { openBlock } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'

const FIRST = 'First words of the attached block.'

test('an edit is a version; an earlier one is compared, kept and restored, and the page comes back', async ({
  page,
  dev,
}) => {
  const original = await readFile(dev.source, 'utf8')
  const field = await openBlock(page, dev.origin)
  await field.fill('First words, changed.')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, changed.' })).toHaveCount(1)

  const toggle = page.getByRole('button', { name: 'Version history', exact: true })
  await toggle.click()
  const card = page.locator('#hadley-versions')
  await expect(card).toBeVisible()
  await expect(card.locator('.hv-day h3')).toHaveText(['Today'])
  const items = card.locator('.hv-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Current version')
  await expect(items.nth(1)).toContainText('from outside')
  await expect(card.locator('.hv-foot')).toContainText('2 versions')

  // what restoring the earlier one would change: the line now out, the line then in, the words that differ marked
  await items.nth(1).click()
  await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'true')
  const diff = card.locator('.hv-diff')
  await expect(diff.locator('.hv-del')).toHaveText('− First words, changed.')
  await expect(diff.locator('.hv-add')).toHaveText(`+ ${FIRST}`)
  await expect(diff.locator('del.hv-word').first()).toBeVisible()
  await expect(diff.locator('ins.hv-word')).toContainText(['attached'])

  // the page as it is: nothing to compare, nothing to restore or delete, only keeping; one row open at a time
  await items.nth(0).click()
  await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'false')
  await expect(card.locator('.hv-diff')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Restore this version', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Keep…', exact: true })).toBeVisible()
  await items.nth(1).click()
  await expect(diff.locator('.hv-gap').first()).toHaveText(/^⋯ \d+ unchanged lines?\s*$/)

  // kept under a name: the row says it, and stays open
  await card.getByRole('button', { name: 'Keep…', exact: true }).click()
  await expect(card.getByText('Kept versions stay.')).toBeVisible()
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill('before the change')
  await page.keyboard.press('Enter')
  await expect(items.nth(1)).toContainText('before the change')
  await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByRole('button', { name: 'Rename…', exact: true })).toBeVisible()

  await card.getByRole('button', { name: 'Restore this version', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Restore this version?')
  // nothing is lost by going back: the question is in the accent, not in the red of deleting
  await expect(page.getByRole('dialog')).toHaveClass(/\bis-calm\b/)
  await expect(page.getByRole('dialog')).toContainText(/how it was today, \d\d?:\d\d( [AP]M)?\./)
  await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
  await expect.poll(() => readFile(dev.source, 'utf8')).toBe(original)
  await expect(page.locator('[data-hadley-id]').filter({ hasText: FIRST })).toHaveCount(1)

  // after the reload: the restored version is current, the one it left is still there
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  const after = page.locator('#hadley-versions .hv-item')
  await expect(after).toHaveCount(3)
  // the page as it is, and which version it came back from (Michael, 2026-11-09)
  await expect(after.nth(0)).toContainText('Current version · restored: before the change')
  await expect(after.nth(1)).toContainText('Editor · Block edited')
  await expect(after.nth(2)).toContainText('before the change')
})

// Michael, 2026-11-09: single versions can be deleted, and every unnamed one at once
test('a version is deleted after a question in its row, every unnamed one from the foot; the kept stay', async ({
  page,
  dev,
}) => {
  await page.goto(dev.origin + '/panel/')
  const original = await readFile(dev.source, 'utf8')
  for (const word of ['one', 'two', 'three']) {
    await writeFile(dev.source, original.replace(FIRST, `First words, ${word}.`))
    await expect(page.locator('[data-hadley-id]').filter({ hasText: `First words, ${word}.` })).toHaveCount(1, {
      timeout: 15_000,
    })
  }
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  const card = page.locator('#hadley-versions')
  const items = card.locator('.hv-item')
  await expect(items).toHaveCount(4)

  // the oldest kept
  await items.nth(3).click()
  await card.getByRole('button', { name: 'Keep…', exact: true }).click()
  await card.getByRole('textbox', { name: 'Name', exact: true }).fill('start')
  await page.keyboard.press('Enter')
  await expect(items.nth(3)).toContainText('start')

  // one deleted: Escape takes the question back, the card stays; then deleted for good
  await items.nth(2).click()
  await card.getByRole('button', { name: 'Delete', exact: true }).click()
  const question = card.getByRole('group', { name: /^Delete this version for good\?/ })
  await expect(question).toBeVisible()
  await expect(question.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(question).toHaveCount(0)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Delete', exact: true }).click()
  await question.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(items).toHaveCount(3)
  await expect(card.locator('.hv-foot')).toContainText('3 versions')

  // every unnamed one but the page as it is
  await card.getByRole('button', { name: 'Delete all unnamed', exact: true }).click()
  await expect(card.locator('.hv-foot')).toContainText(
    'Delete 1 unnamed version? The current one and the kept ones stay.',
  )
  await card.getByRole('button', { name: 'Delete 1', exact: true }).click()
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Current version')
  await expect(items.nth(1)).toContainText('start')
  await expect(card.getByRole('button', { name: 'Delete all unnamed', exact: true })).toHaveCount(0)
  // the page itself is as it was
  await expect(page.locator('[data-hadley-id]').filter({ hasText: 'First words, three.' })).toHaveCount(1)
})

test('the versions button stands in the pill in edit mode only, and Escape closes its card', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  const toggle = page.getByRole('button', { name: 'Version history', exact: true })
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
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  const items = page.locator('#hadley-versions .hv-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Current version')
  await items.nth(1).click()
  await expect(page.locator('#hadley-versions .hv-del')).toHaveText('− First words, from another program.')
})

// Michael, 2026-11-09: one card above the pill at a time, the versions' or the chat's
test('opening the versions closes the chat, and opening the chat closes the versions', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  const versions = page.getByRole('button', { name: 'Version history', exact: true })
  const chat = page.getByRole('button', { name: 'Chat', exact: true })
  const card = page.locator('#hadley-versions')
  const panel = page.locator('#hadley-chat')

  await chat.click()
  await expect(panel).toBeVisible()
  await versions.click()
  await expect(card).toBeVisible()
  await expect(panel).toBeHidden()
  await expect(chat).toHaveAttribute('aria-expanded', 'false')

  await chat.click()
  await expect(panel).toBeVisible()
  await expect(card).toBeHidden()
  await expect(versions).toHaveAttribute('aria-expanded', 'false')

  // closing one opens nothing
  await chat.click()
  await expect(panel).toBeHidden()
  await expect(card).toBeHidden()
})
