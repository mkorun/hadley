// A block opened by a double click in edit mode, the cursor where the pointer was; Ctrl+Enter saves, Enter is a
// new line; a link in a block leads away in edit mode only with Ctrl or Cmd (Michael, 2026-11-09).
import { test, expect } from './chat-fixture.ts'
import { block, editMode } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'

test('a double click in edit mode opens the block, the cursor where the pointer was', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  // out of edit mode a double click only selects
  await block(page, 'First words').getByText('attached').dblclick()
  await page.waitForTimeout(300)
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)

  await editMode(page)
  await block(page, 'First words').dblclick({ position: { x: 5, y: 5 } })
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)

  // on a word: the cursor in it
  const [x, y] = (await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('[data-hadley-id]')].find((e) => e.textContent.includes('First words'))
    const t = b.firstChild
    const i = t.textContent.indexOf('attached')
    const r = document.createRange()
    r.setStart(t, i + 2)
    r.setEnd(t, i + 3)
    const q = r.getBoundingClientRect()
    return [q.x + q.width / 2, q.y + q.height / 2]
  })()`)) as [number, number]
  await page.mouse.dblclick(x, y)
  await expect(field).toBeFocused()
  // the cursor where the pointer was, between the word's second and fourth letter, and nothing selected: a key
  // would type over a selected word (Michael, 2026-11-09)
  const [start, end, at] = (await page.evaluate(
    `(() => { const f = document.querySelector('.hadley-textarea'); return [f.selectionStart, f.selectionEnd, f.value.indexOf('attached')] })()`,
  )) as [number, number, number]
  expect(end).toBe(start)
  expect(start - at).toBeGreaterThanOrEqual(2)
  expect(start - at).toBeLessThanOrEqual(3)
})

test('Ctrl+Enter saves the field; Enter is a new line in it', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  await block(page, 'Second block').dblclick()
  const field = page.locator('.hadley-textarea')
  await expect(field).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- a list item')
  await expect(field).toHaveValue('Second block.\n- a list item')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute(
    'title',
    'Save (Ctrl+Enter or Ctrl+S)',
  )
  // Ctrl+Shift+Enter is the chat's, which rewrites the block: it does not save
  await page.keyboard.press('Control+Shift+Enter')
  await page.waitForTimeout(500)
  await expect(field).toBeVisible()
  expect(await readFile(dev.source, 'utf8')).not.toContain('- a list item')
  await field.focus()
  await page.keyboard.press('Control+Enter')
  await expect.poll(() => readFile(dev.source, 'utf8')).toContain('Second block.\n- a list item')
  await expect(field).toHaveCount(0)
})

test('in edit mode a link in a block leads away only with Ctrl or Cmd; out of it as ever', async ({ page, dev }) => {
  const original = await readFile(dev.source, 'utf8')
  // built before the page is asked for, which else may be the page as it was
  await dev.rebuild(() =>
    writeFile(dev.source, original.replace('Second block.', 'Second block with [a link](/panel/#away).')),
  )
  await page.goto(dev.origin + '/panel/')
  const link = page.getByRole('link', { name: 'a link', exact: true })
  await expect(link).toBeVisible({ timeout: 15_000 })

  await editMode(page)
  await link.click()
  await page.waitForTimeout(300)
  expect(new URL(page.url()).hash).toBe('')
  // Ctrl click: the link as ever (a new tab)
  const opened = page.context().waitForEvent('page')
  await link.click({ modifiers: ['ControlOrMeta'] })
  expect(new URL((await opened).url()).hash).toBe('#away')

  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await link.click()
  await expect.poll(() => new URL(page.url()).hash).toBe('#away')
})
