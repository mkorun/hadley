// The reader's light or dark (themes/*/assets/js/reader.js): a site with the button takes the choice the browser kept;
// one without it keeps its own scheme, so that a choice kept from before cannot hold the reader where no button can
// change it (read-whole runs 2026-11-10). The page is made here, at the served site's origin, so that the choice is
// kept where the script reads it.
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const theme of ['hems', 'punch']) {
  const script = readFile(new URL(`../packages/hadley/themes/${theme}/assets/js/reader.js`, import.meta.url), 'utf8')
  const page = (toggle: boolean) =>
    `<!DOCTYPE html><html lang="en" data-color-scheme="dark"><head><script src="/__reader/${theme}.js"${toggle ? ' data-color-toggle' : ''}></script></head><body></body></html>`

  for (const toggle of [false, true])
    test(`${theme}: ${toggle ? 'with' : 'without'} the button, a kept "light" ${toggle ? 'is' : 'is not'} taken over the site's dark`, async ({
      page: browser,
    }) => {
      await browser.route('**/__reader/page', (route) =>
        route.fulfill({ contentType: 'text/html', body: page(toggle) }),
      )
      await browser.route(`**/__reader/${theme}.js`, async (route) =>
        route.fulfill({ contentType: 'text/javascript', body: await script }),
      )
      await browser.goto('/__reader/page')
      await browser.evaluate((key) => localStorage.setItem(key, 'light'), `${theme}-color-scheme`)
      await browser.reload()
      await expect(browser.locator('html')).toHaveAttribute('data-color-scheme', toggle ? 'light' : 'dark')
    })
}
