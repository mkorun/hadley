// The front matter as a table (addons/editor/assets/editor.js, limaTable): its keys and comments where Lima's outline()
// finds them, a line Lima refuses marked as it is typed, and the layer under the textarea as tall as its text.
import { test, expect } from './chat-fixture.ts'

test('the front matter shows its keys, comments and errors where Lima finds them', async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await page.locator('.hadley-front-matter-badge').click()
  const field = page.locator('.hadley-textarea')
  await expect(page.locator('.hadley-fm-key').first()).toBeVisible()
  await field.press('ControlOrMeta+End')
  await page.keyboard.type('\nAutor:in: Michael # who wrote it\nnote: |\n  foo: bar\nhalf')
  const keys = await page.locator('.hadley-fm-key').allTextContents()
  // a key may hold a colon, and a line of a | scalar is none
  expect(keys).toContain('Autor:in')
  expect(keys).toContain('note')
  expect(keys).not.toContain('foo')
  await expect(page.locator('.hadley-fm-comment')).toHaveText(['# who wrote it'])
  await expect(page.locator('.hadley-fm-line.is-error')).toHaveCount(1)
  await expect(page.locator('.hadley-fm-line.is-error')).toHaveText('half')
  await expect(page.locator('.hadley-fm-status')).toContainText('"half"')
  // finished, the line is a key, and the mark and the message go
  await page.keyboard.type(': yes')
  await expect(page.locator('.hadley-fm-line.is-error')).toHaveCount(0)
  await expect(page.locator('.hadley-fm-status')).toBeHidden()
  const [textHeight, layerHeight] = await page.evaluate(() => {
    const height = (selector: string) => {
      const node = (
        globalThis as unknown as { document: { querySelector(s: string): { scrollHeight: number } } }
      ).document.querySelector(selector)
      return node.scrollHeight
    }
    return [height('.hadley-textarea'), height('.hadley-fm-layer')]
  })
  expect(layerHeight).toBe(textHeight)
  expect(errors).toEqual([])
})
