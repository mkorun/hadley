// A new block below a block, from its menu, and the files of the bundle under the field
// (addons/editor/assets/editor.js, bundleFiles): the new text is saved after the block, an image goes in as Markdown.
import { test, expect } from './chat-fixture.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// a PNG of one pixel
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

test('a new block below takes its text, and a file of the bundle goes in as Markdown', async ({ page, dev }) => {
  await dev.rebuild(() => writeFile(join(dirname(dev.source), 'pixel.png'), PIXEL))
  const before = await readFile(dev.source, 'utf8')
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  const block = page.locator('[data-hadley-id]').filter({ hasText: 'First words' }).first()
  await block.hover()
  await block.locator('.hadley-trigger').hover()
  await page.getByRole('menuitem', { name: 'New block below', exact: true }).click()
  const field = page.locator('.hadley-textarea')
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  // the bundle's image, offered under the field
  const file = page.getByRole('button', { name: 'Insert pixel.png', exact: true })
  await expect(file.locator('img')).toHaveJSProperty('naturalWidth', 1)
  await file.click()
  await expect(field).toHaveValue('![](pixel.png)')
  // the caret waits in the alt text
  await page.keyboard.type('A pixel')
  await expect(field).toHaveValue('![A pixel](pixel.png)')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(() => readFile(dev.source, 'utf8'))
    .toBe(
      before.replace(
        'First words of the attached block.',
        'First words of the attached block.\n\n![A pixel](pixel.png)',
      ),
    )
})
