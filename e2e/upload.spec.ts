// A picture dropped on the field or pasted into it goes into the page's bundle under the name the form gives it
// (addons/editor/browser/features/pictures.ts; plugin.ts, handleUpload), and in at the caret, while the field stays
// open.
import { test, expect } from './chat-fixture.ts'
import { hand, openBlock, PIXEL } from './editor.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { locatedPhoto } from '../packages/hadley/lib/tests/located-photo.ts'

// a PNG of one black pixel, beside the grey one (editor.ts, PIXEL)
const BLACK =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYGAAAAAEAAGjChXjAAAAAElFTkSuQmCC'

test('a dropped picture goes into the bundle under the name given, and in at the caret', async ({ page, dev }) => {
  const bundle = dirname(dev.source)
  const field = await openBlock(page, dev.origin)
  const text = await field.inputValue()
  await hand(page, 'drop', [{ name: 'Karte Ost.PNG', type: 'image/png', base64: PIXEL }])
  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  await expect(name).toHaveValue('karte-ost.png')
  await name.fill('karte.png')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(field).toHaveValue(text + '![](karte.png)')
  expect((await readFile(join(bundle, 'karte.png'))).toString('base64')).toBe(PIXEL)
  // the caret waits in its alt text, the field is still open, and the files show the new one
  await page.keyboard.type('A map')
  await expect(field).toHaveValue(text + '![A map](karte.png)')
  await expect(page.getByRole('button', { name: 'Insert karte.png', exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(field).toHaveValue(text + '![A map](karte.png)')

  // the same name again: asked first, then replaced
  await hand(page, 'drop', [{ name: 'karte.png', type: 'image/png', base64: BLACK }])
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('karte.png is already in the bundle.')).toBeVisible()
  expect((await readFile(join(bundle, 'karte.png'))).toString('base64')).toBe(PIXEL)
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(page.locator('.hadley-add')).toHaveCount(0)
  expect((await readFile(join(bundle, 'karte.png'))).toString('base64')).toBe(BLACK)
})

test('a pasted picture is named by its time; a paste with text is text, Esc leaves the field open', async ({
  page,
  dev,
}) => {
  await openBlock(page, dev.origin)
  await hand(page, 'paste', [{ name: 'image.png', type: 'image/png', base64: PIXEL }], 'copied words')
  await expect(page.locator('.hadley-add')).toHaveCount(0)
  await hand(page, 'paste', [{ name: 'image.png', type: 'image/png', base64: PIXEL }])
  const name = page.getByRole('textbox', { name: 'Name', exact: true })
  await expect(name).toHaveValue(/^picture-\d{4}-\d{2}-\d{2}-\d{4}\.png$/)
  await name.press('Escape')
  await expect(page.locator('.hadley-add')).toHaveCount(0)
  await expect(page.locator('.hadley-textarea')).toBeFocused()
  // a GIF is no picture the bundle takes from the editor
  await hand(page, 'drop', [{ name: 'a.gif', type: 'image/gif', base64: PIXEL }])
  await expect(page.getByText('Only PNG and JPEG pictures can be added to the bundle.')).toBeVisible()
})

test('a photo that says where it was taken is saved as it is, and the editor says so', async ({ page, dev }) => {
  const scratch = await mkdtemp(join(tmpdir(), 'hadley-e2e-photo-'))
  try {
    await locatedPhoto(join(scratch, 'foto.jpg'), 'jpeg')
    const photo = await readFile(join(scratch, 'foto.jpg'))
    await openBlock(page, dev.origin)
    await hand(page, 'drop', [{ name: 'foto.jpg', type: 'image/jpeg', base64: photo.toString('base64') }])
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('foto.jpg says where it was taken.', { exact: false })).toBeVisible()
    expect((await readFile(join(dirname(dev.source), 'foto.jpg'))).equals(photo)).toBe(true)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
