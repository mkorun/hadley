// The bundle's files in the field's drawer (addons/editor/browser/features/files.ts; Michael, 2026-11-09): a picture
// shows larger once the pointer rests on it, and a file can be taken away, after a question in the drawer that says
// whether the page still names it, into the site's .hadley/trash/; the open field stays as it is.
import { test, expect } from './chat-fixture.ts'
import { PIXEL, openBlock, unfold } from './editor.ts'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const files = async (dev: { source: string; rebuild(write: () => Promise<unknown>): Promise<void> }) => {
  const bundle = dirname(dev.source)
  await dev.rebuild(async () => {
    await writeFile(join(bundle, 'used.png'), Buffer.from(PIXEL, 'base64'))
    await writeFile(join(bundle, 'spare.png'), Buffer.from(PIXEL, 'base64'))
    await writeFile(dev.source, (await readFile(dev.source, 'utf8')).replace('Second block.', 'Second ![](used.png).'))
  })
  return bundle
}

test('a picture shows larger once the pointer rests on it, and goes as it leaves', async ({ page, dev }) => {
  await files(dev)
  await openBlock(page, dev.origin)
  await unfold(page, 'Files (2)')
  const preview = page.locator('.hadley-file-preview')
  await page.getByRole('button', { name: 'Insert spare.png', exact: true }).hover()
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 1)
  await page.locator('.hadley-textarea').hover()
  await expect(preview).toHaveCount(0)
})

test('a file is taken away after a question, into the trash; one the page names says so first', async ({
  page,
  dev,
}) => {
  const bundle = await files(dev)
  const field = await openBlock(page, dev.origin)
  await field.fill('First words, not saved yet.')
  await page.evaluate('window.__mark = 1')
  await unfold(page, 'Files (2)')

  // the page names it: the question says so; Cancel keeps it
  await page.getByRole('button', { name: 'Insert used.png', exact: true }).hover()
  await page.getByRole('button', { name: 'Delete used.png', exact: true }).click()
  const used = page.getByRole('group', { name: 'used.png is still used in the text. Delete it anyway?' })
  await expect(used.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await used.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(used).toHaveCount(0)

  await page.getByRole('button', { name: 'Insert spare.png', exact: true }).hover()
  await page.getByRole('button', { name: 'Delete spare.png', exact: true }).click()
  const ask = page.getByRole('group', { name: 'Delete spare.png?' })
  await ask.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.hadley-drawer-toggle').filter({ hasText: 'Files (1)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Insert spare.png', exact: true })).toHaveCount(0)
  expect(await readdir(bundle)).not.toContain('spare.png')
  const trash = join(dirname(dev.config), '.hadley', 'trash')
  const [moment] = await readdir(trash)
  expect(await readdir(join(trash, moment!, 'content', 'articles', '[panel]'))).toEqual(['spare.png'])
  // the field is as it was: no reload took its text
  await page.waitForTimeout(800)
  expect(await page.evaluate('window.__mark === 1')).toBe(true)
  await expect(field).toHaveValue('First words, not saved yet.')
})

test('a file the server would not take away: the question says why, and may be asked again', async ({ page, dev }) => {
  await files(dev)
  await openBlock(page, dev.origin)
  await unfold(page, 'Files (2)')
  await page.route('**/__hadley/trash*', (route) =>
    route.fulfill({ status: 500, json: { error: 'Could not write file' } }),
  )
  await page.getByRole('button', { name: 'Insert spare.png', exact: true }).hover()
  await page.getByRole('button', { name: 'Delete spare.png', exact: true }).click()
  const ask = page.getByRole('group', { name: 'Delete spare.png?' })
  await ask.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(ask.getByRole('status')).toHaveText('Could not write file')
  await expect(ask.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
  // Escape takes the question back, not the field
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  await expect(page.locator('.hadley-textarea')).toBeVisible()
})
