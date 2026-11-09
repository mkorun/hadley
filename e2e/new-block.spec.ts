// A new block below a block, from its menu, and the files of the bundle under the field
// (addons/editor/browser/features/files.ts): the new text is saved after the block, an empty one is no edit, an
// image goes in as Markdown and any other file as a link.
import { test, expect } from './chat-fixture.ts'
import { fromMenu, openBlock, PIXEL } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const FIRST = 'First words of the attached block.'

test('a new block below takes its text, and a file of the bundle goes in as Markdown', async ({ page, dev }) => {
  await dev.rebuild(() => writeFile(join(dirname(dev.source), 'pixel.png'), Buffer.from(PIXEL, 'base64')))
  const before = await readFile(dev.source, 'utf8')
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'First words', 'New block below')
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
  await expect.poll(() => readFile(dev.source, 'utf8')).toBe(before.replace(FIRST, `${FIRST}\n\n![A pixel](pixel.png)`))
})

test('an empty new block is no edit: the field closes, nothing is sent or written', async ({ page, dev }) => {
  const before = await readFile(dev.source, 'utf8')
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/__hadley/patch')) sent.push(request.url())
  })
  await page.goto(dev.origin + '/panel/')
  await fromMenu(page, 'First words', 'New block below')
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  await field.fill(' \n\n ')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(field).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(sent).toEqual([])
  expect(await readFile(dev.source, 'utf8')).toBe(before)
})

test('a file of the bundle that is no image goes in as a link, with the caret after it', async ({ page, dev }) => {
  await dev.rebuild(() => writeFile(join(dirname(dev.source), 'notes.txt'), 'Notes.\n'))
  const before = await readFile(dev.source, 'utf8')
  const field = await openBlock(page, dev.origin)
  await page.getByRole('button', { name: 'Insert notes.txt', exact: true }).click()
  await expect(field).toHaveValue(`${FIRST}[notes.txt](notes.txt)`)
  await page.keyboard.type(' See them.')
  await expect(field).toHaveValue(`${FIRST}[notes.txt](notes.txt) See them.`)
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => readFile(dev.source, 'utf8'))
    .toBe(before.replace(FIRST, `${FIRST}[notes.txt](notes.txt) See them.`))
})
