// What every test of the editor does first (addons/editor/browser/): edit mode on, a block's field open, an
// action of a block's menu; and what a browser hands the field when a picture is dropped on it or pasted into it.
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** A PNG of one grey pixel, base64. */
export const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Edit mode on. The page may have just reloaded: the toggle says where edit mode stands once the editor started. */
export const editMode = async (page: Page) => {
  const toggle = page.getByRole('button', { name: 'Toggle edit mode', exact: true })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-pressed')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('body.hadley-edit-mode')).toHaveCount(1)
}

/** The block that holds `text`. */
export const block = (page: Page, text: string) => page.locator('[data-hadley-id]').filter({ hasText: text }).first()

/** The panel page in edit mode, and the field of its first block open, focused. */
export const openBlock = async (page: Page, origin: string) => {
  await page.goto(origin + '/panel/')
  await editMode(page)
  await block(page, 'First words').click({ button: 'right' })
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  return field
}

/** An action of the menu of the block that holds `text`, after the page shows the block. */
export const fromMenu = async (page: Page, text: string, item: string) => {
  await editMode(page)
  const target = block(page, text)
  await target.hover()
  await target.locator('.hadley-trigger').hover()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** The messages of the page's dialogs, each accepted as it comes. */
export const dialogs = (page: Page): string[] => {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.accept()
  })
  return messages
}

export type Picture = { name: string; type: string; base64: string }

// the browser's own constructors, which the repository's TypeScript (no DOM) does not know
type Browser = {
  DataTransfer: new () => { items: { add(file: unknown): void }; setData(type: string, value: string): void }
  File: new (parts: unknown[], name: string, options: { type: string }) => unknown
  ClipboardEvent: new (type: string, init: object) => unknown
  DragEvent: new (type: string, init: object) => unknown
}

/**
 * What a browser hands the field: a drop of files, or a paste of a clipboard, with text beside the files or not. The
 * event carries the data as its own property: Firefox gives a ClipboardEvent made with a DataTransfer an empty copy.
 */
export const hand = (page: Page, kind: 'drop' | 'paste', pictures: Picture[], text?: string) =>
  page.locator('.hadley-textarea').evaluate(
    (field: { dispatchEvent(event: unknown): boolean }, { kind, pictures, text }) => {
      const { DataTransfer, File, ClipboardEvent, DragEvent } = globalThis as unknown as Browser
      const data = new DataTransfer()
      for (const { name, type, base64 } of pictures)
        data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      if (text !== undefined) data.setData('text/plain', text)
      const event = (type: string) => {
        const init = { bubbles: true, cancelable: true }
        const made = kind === 'paste' ? new ClipboardEvent(type, init) : new DragEvent(type, init)
        Object.defineProperty(made, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data })
        return made
      }
      if (kind === 'paste') field.dispatchEvent(event('paste'))
      else {
        field.dispatchEvent(event('dragover'))
        field.dispatchEvent(event('drop'))
      }
    },
    { kind, pictures, text },
  )

/** The open field's drawer whose toggle says `name` unfolded (addons/editor/browser/features/drawers.ts). */
export const unfold = async (page: Page, name: string | RegExp) => {
  const toggle = page.locator('.hadley-drawer-toggle').filter({ hasText: name })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}
