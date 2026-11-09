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
    const switcher = page.locator('#hadley-lang-toggle')
    await expect(switcher).toHaveText('EN')
    await switcher.click()
    await expect(page.locator('#hadley-edit-toggle')).toHaveText('Edit')
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
