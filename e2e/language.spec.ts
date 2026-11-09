// The editor speaks the author's language, not the page's (addons/editor/browser/core/texts.ts): the first of the
// browser's languages it knows, else English; the switch in its control keeps another for the site.
import { test, expect } from './chat-fixture.ts'

test.describe('a German browser', () => {
  test.use({ locale: 'de-DE' })

  test('gets German on an English page, and the switch keeps English for the site', async ({ page, dev }) => {
    await page.goto(dev.origin + '/panel/')
    const edit = page.locator('#hadley-edit-toggle')
    await expect(edit).toHaveText('Bearbeiten')
    await edit.click()
    // the language it speaks, and a menu of all (Michael, 2026-11-09: "EN" on a German editor was confusing)
    const switcher = page.getByRole('button', { name: 'Sprache des Editors: Deutsch', exact: true })
    await expect(switcher).toHaveText('DE▾')
    await expect(switcher).toHaveAttribute('aria-expanded', 'false')
    await switcher.click()
    const menu = page.getByRole('menu', { name: 'Sprache des Editors' })
    await expect(menu.getByRole('menuitemradio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio', { name: 'Deutsch' })).toBeFocused()
    // Escape closes it, and the button has the focus again
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(switcher).toBeFocused()
    await switcher.click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.locator('#hadley-edit-toggle')).toHaveText('Edit')
    await expect(page.getByRole('button', { name: 'Editor language: English', exact: true })).toHaveText('EN▾')
    // kept for the site, not only the tab
    await page.goto(dev.origin + '/de/panel/')
    await expect(page.locator('#hadley-edit-toggle')).toHaveText('Edit')
  })
})

test.describe('a browser in a language the editor does not speak', () => {
  test.use({ locale: 'ja-JP' })

  test('gets English, even on a German page', async ({ page, dev }) => {
    await page.goto(dev.origin + '/de/panel/')
    await expect(page.locator('#hadley-edit-toggle')).toHaveText('Edit')
  })
})

// Michael, 2026-11-09: out of edit mode the pill steps back, but for Edit, the way in; it comes forward under the
// pointer
test('the pill steps back out of edit mode but for Edit, and comes forward under the pointer', async ({
  page,
  dev,
}) => {
  await page.goto(dev.origin + '/panel/')
  const pill = page.locator('.hadley-pill')
  const edit = page.locator('#hadley-edit-toggle')
  const chat = page.locator('#hadley-chat-toggle')
  await expect(edit).toHaveCSS('opacity', '1')
  await expect(chat).toHaveCSS('opacity', '0.55')
  await pill.hover()
  await expect(chat).toHaveCSS('opacity', '1')
  await page.mouse.move(5, 5)
  await edit.click()
  await page.mouse.move(5, 5)
  await expect(chat).toHaveCSS('opacity', '1')
})
