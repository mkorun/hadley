// A file that changed on disk after the page was rendered (addons/editor/plugin.ts, fileHashAtRender): the server
// refuses to open or to save a block of it with 409, and the editor says so and reloads the page. The window is the one
// before the dev server's rebuild registers the file anew: it waits 150 ms after the write, and then builds.
import { test, expect } from './chat-fixture.ts'
import { block, dialogs, editMode, openBlock } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'

const changeOnDisk = async (source: string) => {
  const changed = (await readFile(source, 'utf8')).replace('Second block.', 'Second block, changed on disk.')
  await writeFile(source, changed)
  return changed
}

test('a block of a file that changed is not opened: the editor says so and reloads', async ({ page, dev }) => {
  const messages = dialogs(page)
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  await changeOnDisk(dev.source)
  await block(page, 'First words').click({ button: 'right' })
  await expect.poll(() => messages).toEqual(['Block no longer found — reloading page.'])
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  // reloaded, the page shows the file as it is
  await expect(block(page, 'Second block')).toHaveText('Second block, changed on disk.')
})

test('a save into a file that changed is refused: the editor says so and reloads', async ({ page, dev }) => {
  const messages = dialogs(page)
  const field = await openBlock(page, dev.origin)
  await field.fill('First words, edited too late.')
  const changed = await changeOnDisk(dev.source)
  await page.keyboard.press('Control+s')
  await expect.poll(() => messages).toEqual(['The file was changed externally.\nReloading page.'])
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  await expect(block(page, 'Second block')).toHaveText('Second block, changed on disk.')
  expect(await readFile(dev.source, 'utf8')).toBe(changed)
})
