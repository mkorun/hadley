// The front matter as a table (addons/editor/browser/features/front-matter.ts): its keys and comments where Lima's
// outline() finds them, a line Lima refuses marked as it is typed, and the layer under the textarea as tall as its
// text. Edited and saved, with a save the server refuses; and without Lima, which the table says.
import { test, expect } from './chat-fixture.ts'
import { dialogs, editMode } from './editor.ts'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

const FRONT_MATTER = 'title: Panel\npublishFrom: 2026-01-01'

// the front matter's field, from its badge
const open = async (page: Page, origin: string) => {
  await page.goto(origin + '/panel/')
  await editMode(page)
  await page.locator('.hadley-front-matter-badge').click()
  const field = page.locator('.hadley-textarea')
  await expect(field).toHaveValue(FRONT_MATTER)
  return field
}

test('the front matter shows its keys, comments and errors where Lima finds them', async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const field = await open(page, dev.origin)
  // Lima has loaded once the first key stands in the layer; not toBeVisible: WebKit on Linux gives an inline element
  // in a generic monospace font a box of height 0, though it draws it
  await expect(page.locator('.hadley-fm-key').first()).toHaveText('title')
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

test('the front matter is edited and saved, and a line Lima refuses refuses the save', async ({ page, dev }) => {
  const messages = dialogs(page)
  const before = await readFile(dev.source, 'utf8')
  const field = await open(page, dev.origin)
  await field.fill('title: Panel, renamed\npublishFrom: 2026-01-01\ndescription: Edited')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => readFile(dev.source, 'utf8'))
    .toBe(before.replace(FRONT_MATTER, 'title: Panel, renamed\npublishFrom: 2026-01-01\ndescription: Edited'))
  // the page reloads with its new title
  await expect(page.locator('[data-hadley-head="title"]')).toHaveText('Panel, renamed')
  await editMode(page)
  await page.locator('.hadley-front-matter-badge').click()
  await expect(field).toHaveValue(/^title: Panel, renamed/)
  // a line Lima refuses: the server refuses the save with Lima's message, and the field stays as it is
  await field.press('ControlOrMeta+End')
  await page.keyboard.type('\nhalf')
  await expect(page.locator('.hadley-fm-line.is-error')).toHaveText('half')
  await page.keyboard.press('Control+s')
  await expect.poll(() => messages).toHaveLength(1)
  expect(messages[0]).toContain('Lima: unrecognised line: "half"')
  await expect(field).toHaveValue('title: Panel, renamed\npublishFrom: 2026-01-01\ndescription: Edited\nhalf')
  expect(await readFile(dev.source, 'utf8')).toContain('description: Edited\n---\n')
})

test('without Lima the table marks nothing, says so, and the front matter still saves', async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route('**/__hadley/lima/*', (route) => route.fulfill({ status: 500, body: 'no module' }))
  const before = await readFile(dev.source, 'utf8')
  const field = await open(page, dev.origin)
  await expect(page.locator('.hadley-fm-status')).toHaveText(
    'Lima could not be loaded: keys and errors show only when saving',
  )
  await expect(page.locator('.hadley-fm-line')).toHaveCount(2)
  await expect(page.locator('.hadley-fm-key')).toHaveCount(0)
  await field.press('ControlOrMeta+End')
  await page.keyboard.type('\ndescription: Without Lima')
  await page.keyboard.press('Control+s')
  await expect
    .poll(() => readFile(dev.source, 'utf8'))
    .toBe(before.replace(FRONT_MATTER, `${FRONT_MATTER}\ndescription: Without Lima`))
  expect(errors).toEqual([])
})

// Michael, 2026-11-09: the badge slid down below the open field, over its row of buttons
test('the badge stays above the front matter while its field is open', async ({ page, dev }) => {
  const field = await open(page, dev.origin)
  const badge = page.locator('.hadley-front-matter-badge')
  // open: it says so, and takes no pointer while its field is open (Michael, 2026-11-09)
  await expect(badge).toHaveAttribute('aria-expanded', 'true')
  await expect(badge).toHaveCSS('pointer-events', 'none')
  const wrapper = page.locator('.hadley-editor')
  await expect
    .poll(async () => {
      const [b, w] = await Promise.all([badge.boundingBox(), wrapper.boundingBox()])
      return b !== null && w !== null && b.y + b.height <= w.y + 1
    })
    .toBe(true)
})

// Michael, 2026-11-09: the front matter's field was narrower than the title's frame under it
test('an open field is as wide as the frames of the blocks round it', async ({ page, dev }) => {
  await open(page, dev.origin)
  const field = await page.locator('.hadley-editor').boundingBox()
  const frames = page.locator('.hadley-frame')
  await expect(frames.first()).toBeAttached()
  const boxes = await frames.evaluateAll((all) =>
    all.map((frame) => {
      const style = (frame as unknown as { style: { left: string; width: string } }).style
      return { left: parseFloat(style.left), width: parseFloat(style.width) }
    }),
  )
  const widest = boxes.reduce((a, b) => (b.width > a.width ? b : a))
  expect(Math.abs((field?.x ?? 0) - widest.left)).toBeLessThanOrEqual(1)
  expect(Math.abs((field?.width ?? 0) - widest.width)).toBeLessThanOrEqual(1)
})

// Michael, 2026-11-09: an article without a description says so on its badge, while writing; the terminal tells only
// of a published one
test('an article without a description: a dot on the badge says so, and goes once one is saved', async ({
  page,
  dev,
}) => {
  const field = await open(page, dev.origin)
  const badge = page.locator('.hadley-front-matter-badge')
  await expect(badge.locator('.hadley-badge-dot')).toHaveCount(1)
  await expect(badge).toHaveAttribute(
    'title',
    'No description: link previews and feeds show the first words of the text.',
  )
  // its name stays: the title is said after it
  await expect(page.getByRole('button', { name: 'Front matter', exact: true })).toHaveCount(1)
  await field.fill(FRONT_MATTER + '\ndescription: A line of its own.')
  await page.keyboard.press('Control+s')
  await expect(badge.locator('.hadley-badge-dot')).toHaveCount(0)
  await expect(badge).toHaveAttribute('title', 'Front matter')
  expect(await readFile(dev.source, 'utf8')).toContain('description: A line of its own.')
})
