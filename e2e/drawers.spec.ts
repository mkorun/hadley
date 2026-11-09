// The open field's seldom needed tools folded away under its toolbar (addons/editor/browser/features/drawers.ts;
// Michael, 2026-11-09): one drawer open at a time, the one open last open again in the next field, and a rewrite asked
// by its keys unfolds its own; the text stays in view throughout.
import { test, expect } from './chat-fixture.ts'
import { PIXEL, block, hand, openBlock, unfold } from './editor.ts'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

test('the drawers start folded, one opens at a time, and the next field opens the one open last', async ({
  page,
  dev,
}) => {
  // a bundle without files has no drawer for them; this one has one
  await dev.rebuild(() => writeFile(join(dirname(dev.source), 'pixel.png'), Buffer.from(PIXEL, 'base64')))
  const field = await openBlock(page, dev.origin)
  const files = page.locator('.hadley-drawer-toggle').filter({ hasText: 'Files (1)' })
  const rewrite = page.locator('.hadley-drawer-toggle').filter({ hasText: 'Rewrite' })
  await expect(files).toHaveAttribute('aria-expanded', 'false')
  await expect(rewrite).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Insert pixel.png', exact: true })).toBeHidden()
  await expect(page.locator('.hadley-rewrite')).toBeHidden()

  await files.click()
  await expect(page.getByRole('button', { name: 'Insert pixel.png', exact: true })).toBeVisible()
  await rewrite.click()
  await expect(page.locator('.hadley-rewrite')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Insert pixel.png', exact: true })).toBeHidden()
  await expect(files).toHaveAttribute('aria-expanded', 'false')
  await expect(field).toBeVisible()

  // the next field: the one open last
  await page.keyboard.press('Escape')
  await block(page, 'Second block').click({ button: 'right' })
  await expect(page.locator('.hadley-rewrite')).toBeVisible()
  // folded, it stays folded in the next one
  await page.locator('.hadley-drawer-toggle').filter({ hasText: 'Rewrite' }).click()
  await page.keyboard.press('Escape')
  await block(page, 'First words').click({ button: 'right' })
  await expect(page.locator('.hadley-textarea')).toBeFocused()
  await expect(page.locator('.hadley-rewrite')).toBeHidden()
})

test('a rewrite asked by its keys unfolds its drawer', async ({ page, dev }) => {
  const field = await openBlock(page, dev.origin)
  await expect(page.locator('.hadley-rewrite')).toBeHidden()
  await field.press('Control+Shift+Enter')
  await expect(page.locator('.hadley-rewrite')).toBeVisible()
  await expect(page.locator('.hadley-drawer-toggle').filter({ hasText: 'Rewrite' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

// Michael, 2026-11-09: the files in rows, never scrolled sideways; one put in after another, never into it
test('many files wrap into rows, and a second file goes in after the first, not into it', async ({ page, dev }) => {
  const bundle = dirname(dev.source)
  await dev.rebuild(async () => {
    for (let i = 1; i <= 8; i++) await writeFile(join(bundle, `picture-${i}.png`), Buffer.from(PIXEL, 'base64'))
  })
  const field = await openBlock(page, dev.origin)
  await unfold(page, 'Files (8)')
  // nothing scrolls, not sideways, not down, and every file stands inside the drawer
  const seen = await page.evaluate(`(() => {
    const strip = document.querySelector('.hadley-files')
    const style = getComputedStyle(strip)
    const drawer = strip.closest('.hadley-drawer').getBoundingClientRect()
    const inside = [...strip.querySelectorAll('.hadley-file')].every((f) => {
      const r = f.getBoundingClientRect()
      return r.left >= drawer.left && r.right <= drawer.right && r.bottom <= drawer.bottom
    })
    return [style.overflowX, style.overflowY, inside]
  })()`)
  expect(seen).toEqual(['visible', 'visible', true])
  await field.press('Control+End')
  await page.getByRole('button', { name: 'Insert picture-1.png', exact: true }).click()
  // the caret waits in the first one's alt text; the second goes after it
  await page.getByRole('button', { name: 'Insert picture-2.png', exact: true }).click()
  await expect(field).toHaveValue('First words of the attached block.![](picture-1.png)![](picture-2.png)')
})

test('a picture dropped anywhere on the field is taken, its toolbar too', async ({ page, dev }) => {
  await openBlock(page, dev.origin)
  await hand(
    page,
    'drop',
    [{ name: 'Elsewhere.png', type: 'image/png', base64: PIXEL }],
    undefined,
    '.hadley-editor-toolbar',
  )
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('elsewhere.png')
})
