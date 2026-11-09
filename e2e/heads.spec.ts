// A page's title and subtitle (addons/editor/browser/features/heads.ts): where the text gives them, a right
// click edits their text while `#` and `__` stay the editor's; where the front matter gives them, it edits the front
// matter. And the block menu from the keyboard. Written before the editor is rebuilt (2026-11-08), as its measure.
import { test, expect } from './chat-fixture.ts'
import { editMode } from './editor.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

test('a title and subtitle the text gives are edited as their text, and their syntax stays', async ({ page, dev }) => {
  const bundle = join(dirname(dirname(dev.source)), '[headed]')
  const file = join(bundle, 'headed.md')
  await dev.rebuild(async () => {
    await mkdir(bundle, { recursive: true })
    await writeFile(file, '---\npublishFrom: 2026-01-01\n---\n# Headed\n\n__Below it__\n\nBody of the page.\n')
  })
  await page.goto(dev.origin + '/headed/')
  await editMode(page)
  await page.locator('[data-hadley-head="title"]').click({ button: 'right' })
  const field = page.locator('.hadley-textarea')
  await expect(field).toHaveValue('Headed')
  await field.fill('Headed anew')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toContain('# Headed anew\n\n__Below it__\n')
  // the page reloads with the new title before the next edit
  await expect(page.locator('[data-hadley-head="title"]')).toHaveText('Headed anew')
  await editMode(page)
  await page.locator('[data-hadley-head="subtitle"]').click({ button: 'right' })
  await expect(field).toHaveValue('Below it')
  await field.fill('Further below')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toContain('# Headed anew\n\n__Further below__\n')
})

test('a title the front matter gives opens the front matter', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  await page.locator('[data-hadley-head="title"]').click({ button: 'right' })
  await expect(page.locator('.hadley-textarea')).toHaveValue(/^title: Panel\npublishFrom: 2026-01-01$/)
})

test('the block menu opens from the keyboard, and Escape closes it', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  const block = page.locator('[data-hadley-id]').filter({ hasText: 'First words' }).first()
  await block.hover()
  const trigger = block.locator('.hadley-trigger')
  await trigger.focus()
  await page.mouse.move(0, 0)
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Move block down', exact: true })).toBeVisible()
  await expect(page.locator(':focus')).toHaveAttribute('role', 'menuitem')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Move block down', exact: true })).toBeHidden()
})
