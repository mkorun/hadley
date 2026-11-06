// A picture dropped on the field or pasted into it goes into the page's bundle under the name the form gives it
// (addons/editor/assets/editor.js, addPicture; plugin.ts, handleUpload), and in at the caret, while the field stays
// open.
import { test, expect } from './chat-fixture.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'
import { locatedPhoto } from '../packages/hadley/lib/tests/located-photo.ts'

// PNGs of one pixel, a grey one and a black one
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const BLACK =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYGAAAAAEAAGjChXjAAAAAElFTkSuQmCC'

type Picture = { name: string; type: string; base64: string }

const open = async (page: Page, origin: string) => {
  await page.goto(origin + '/panel/')
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await page.locator('[data-hadley-id]').filter({ hasText: 'First words' }).first().click({ button: 'right' })
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  return field
}

// the browser's own constructors, which the repository's TypeScript (no DOM) does not know
type Browser = {
  DataTransfer: new () => { items: { add(file: unknown): void }; setData(type: string, value: string): void }
  File: new (parts: unknown[], name: string, options: { type: string }) => unknown
  ClipboardEvent: new (type: string, init: object) => unknown
  DragEvent: new (type: string, init: object) => unknown
}

// what a browser hands the field: a drop of files, or a paste of a clipboard, with text beside the files or not
const hand = (page: Page, kind: 'drop' | 'paste', pictures: Picture[], text?: string) =>
  page.locator('.hadley-textarea').evaluate(
    (field: { dispatchEvent(event: unknown): boolean }, { kind, pictures, text }) => {
      const { DataTransfer, File, ClipboardEvent, DragEvent } = globalThis as unknown as Browser
      const data = new DataTransfer()
      for (const { name, type, base64 } of pictures)
        data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      if (text !== undefined) data.setData('text/plain', text)
      const init = { bubbles: true, cancelable: true }
      if (kind === 'paste') field.dispatchEvent(new ClipboardEvent('paste', { ...init, clipboardData: data }))
      else {
        field.dispatchEvent(new DragEvent('dragover', { ...init, dataTransfer: data }))
        field.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: data }))
      }
    },
    { kind, pictures, text },
  )

test('a dropped picture goes into the bundle under the name given, and in at the caret', async ({ page, dev }) => {
  const bundle = dirname(dev.source)
  const field = await open(page, dev.origin)
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
  await open(page, dev.origin)
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
    await open(page, dev.origin)
    await hand(page, 'drop', [{ name: 'foto.jpg', type: 'image/jpeg', base64: photo.toString('base64') }])
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('foto.jpg says where it was taken.', { exact: false })).toBeVisible()
    expect((await readFile(join(dirname(dev.source), 'foto.jpg'))).equals(photo)).toBe(true)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
