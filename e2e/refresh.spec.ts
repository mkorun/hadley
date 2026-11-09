// The page brought up to date in place after a change to its Markdown (addons/editor/browser/refresh/,
// private/docs/SPEC_hadley-soft-reload.md): no reload, so that scroll position and open cards stay; a reload where
// anything but Markdown changed; the editor locked until the page is up to date, and freed with a note when the
// rebuild fails.
import { test, expect } from './chat-fixture.ts'
import { block, editMode, fromMenu, openBlock } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

// a mark on the window: it survives a change in place, never a reload
const mark = (page: Page) => page.evaluate('window.__hadleyMark = 1')
const marked = (page: Page) => page.evaluate('window.__hadleyMark === 1')

// the content as the server made it, without what the editor adds to it, and the ids of all blocks
const content = (page: Page) =>
  page.evaluate(`(() => {
    const first = document.querySelector('[data-hadley-id]')
    const root = first.parentElement.cloneNode(true)
    for (const e of root.querySelectorAll('[class^="hadley-"], [class*=" hadley-"]')) e.remove()
    const ids = [...document.querySelectorAll('[data-hadley-id]')].map((e) => e.getAttribute('data-hadley-id'))
    return { html: root.innerHTML.replace(/>\\s+</g, '><').trim(), ids }
  })()`)

test('a save changes the page in place: no reload, the versions card stays, the new block has its trigger', async ({
  page,
  dev,
}) => {
  const field = await openBlock(page, dev.origin)
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  await expect(page.locator('#hadley-versions')).toBeVisible()
  await mark(page)
  await field.fill('First words, saved in place.')
  await page.keyboard.press('Control+s')
  await expect(block(page, 'First words, saved in place.')).toBeVisible()
  expect(await marked(page)).toBe(true)
  await expect(page.locator('#hadley-versions')).toBeVisible()
  // the editor is free again, and the changed block has its trigger
  const toggle = page.getByRole('button', { name: 'Toggle edit mode', exact: true })
  await expect(toggle).toBeEnabled()
  await expect(block(page, 'First words, saved in place.').locator('.hadley-trigger')).toHaveCount(1)
  // and the new block can be edited right away
  await block(page, 'First words, saved in place.').click({ button: 'right' })
  await expect(page.locator('.hadley-textarea')).toHaveValue('First words, saved in place.')
})

test('a change to the file from outside, with a footnote: in place, and as the page loaded afresh', async ({
  page,
  dev,
}) => {
  await page.goto(dev.origin + '/panel/')
  await mark(page)
  const original = await readFile(dev.source, 'utf8')
  await writeFile(
    dev.source,
    original.replace('Second block.', 'A new block with a note.[^n]\n\nSecond block.') + '\n[^n]: The note.\n',
  )
  await expect(block(page, 'A new block with a note.')).toBeVisible({ timeout: 15_000 })
  expect(await marked(page)).toBe(true)
  const live = await content(page)
  const fresh = await page.context().newPage()
  await fresh.goto(dev.origin + '/panel/')
  expect(live).toEqual(await content(fresh))
})

test('the title changed: the title of the page and its head follow in place', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await mark(page)
  const original = await readFile(dev.source, 'utf8')
  await writeFile(dev.source, original.replace('title: Panel', 'title: Panel, renamed'))
  await expect(page).toHaveTitle(/Panel, renamed/, { timeout: 15_000 })
  await expect(page.locator('[data-hadley-head="title"]')).toHaveText('Panel, renamed')
  expect(await marked(page)).toBe(true)
})

test('a change to the theme reloads the page', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await mark(page)
  const css = join(dev.site, 'theme', 'assets', 'css', 'style.css')
  await writeFile(css, (await readFile(css, 'utf8')) + '\nbody { outline: 3px solid rgb(1, 2, 3); }\n')
  await expect(page.locator('body')).toHaveCSS('outline-color', 'rgb(1, 2, 3)', { timeout: 15_000 })
  expect(await marked(page)).toBe(false)
})

test('a change from outside waits while a field is open, and comes once it is closed', async ({ page, dev }) => {
  const field = await openBlock(page, dev.origin)
  await mark(page)
  const original = await readFile(dev.source, 'utf8')
  await writeFile(dev.source, original.replace('Second block.', 'Second block, from outside.'))
  await expect(page.getByRole('status').filter({ hasText: 'The page has changed' })).toBeVisible({ timeout: 15_000 })
  await expect(block(page, 'Second block')).toHaveText(/^Second block\.$/)
  await expect(field).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(block(page, 'Second block')).toContainText('Second block, from outside.')
  expect(await marked(page)).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: 'The page has changed' })).toHaveCount(0)
})

test('a rebuild that fails frees the editor and says so; the page stays as it was', async ({ page, dev }) => {
  const field = await openBlock(page, dev.origin)
  await mark(page)
  // hadley forgives much; a config without the pages' language it does not (lib/site-config.ts)
  const before = await readFile(dev.config, 'utf8')
  const failed = page.getByRole('status').filter({ hasText: 'The rebuild failed, see the terminal' })
  await writeFile(dev.config, before.replace(/^ {4}language: \w+\n/m, ''))
  try {
    await expect(failed).toBeVisible({ timeout: 15_000 })
    // a save now: written, its rebuild fails too, and the editor does not wait for it
    await field.fill('First words, saved while the build fails.')
    await page.keyboard.press('Control+s')
    await expect.poll(() => readFile(dev.source, 'utf8')).toContain('saved while the build fails')
    // the rebuild after it fails in well under a second; a waiting editor would stay locked for 15 s
    await page.waitForTimeout(1500)
    await expect(failed).toBeVisible()
    await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
    await expect(block(page, 'First words')).not.toHaveClass(/hadley-pending/)
    expect(await marked(page)).toBe(true)
  } finally {
    await writeFile(dev.config, before)
  }
})

// Michael, 2026-11-09: after a block was moved, a paragraph lay over another: the blocks that stay kept the styles of
// the action's animation, which a reload used to clear
for (const [action, item, text, done] of [
  ['moved', 'Move block down', 'First words', 'Second block.\n\nFirst words'],
  ['merged', 'Merge with block below', 'First words', 'First words of the attached block.\nSecond block.'],
  ['deleted', 'Delete block', 'Second block', 'First words of the attached block.\n'],
] as const) {
  test(`a block ${action}: the blocks that stay keep no style of the animation, and none overlaps another`, async ({
    page,
    dev,
  }) => {
    const original = await readFile(dev.source, 'utf8')
    // built before the page is asked for: asked within the moment before the watcher sees the change, it was the page
    // as it was (Gemini Flash's run 20261109-2126-rofo)
    await dev.rebuild(() => writeFile(dev.source, original.replace('Second block.', 'Second block.\n\nThird block.')))
    await page.goto(dev.origin + '/panel/')
    await expect(block(page, 'Third block')).toBeVisible()
    await mark(page)
    await fromMenu(page, text, item)
    await expect.poll(() => readFile(dev.source, 'utf8')).toContain(done)
    // the page brought up to date: the animation's styles gone with it (a reload took them once)
    await expect(page.locator('[data-hadley-id][style]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
    expect(await marked(page)).toBe(true)
    const boxes = await page.evaluate(
      `[...document.querySelectorAll('[data-hadley-id]')].map((b) => [b.getBoundingClientRect().top, b.getBoundingClientRect().bottom])`,
    )
    const sorted = (boxes as [number, number][]).toSorted((a, b) => a[0] - b[0])
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]).toBeGreaterThanOrEqual(sorted[i - 1]![1] - 0.5)
  })
}

// Michael, 2026-11-09: saving can take a while; the field says so where one works, until the page shows the block
test('a field being saved stays, locked and turning, until the page shows its block anew', async ({ page, dev }) => {
  const field = await openBlock(page, dev.origin)
  await mark(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/__hadley/patch*', async (route) => {
    await held
    await route.continue()
  })
  await field.fill('First words, saved slowly.')
  await page.keyboard.press('Control+Enter')
  const save = page.locator('.hadley-save-btn')
  await expect(save).toHaveText('Saving…')
  await expect(save).toBeDisabled()
  await expect(field).toHaveJSProperty('readOnly', true)
  // Escape does not take a field away that is being saved... once the server took it
  release()
  await expect(page.locator('.hadley-editor-toolbar .hadley-cancel-btn')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('.hadley-discard')).toHaveCount(0)
  // the field goes once the page shows the block anew, in place
  await expect(block(page, 'First words, saved slowly.')).toBeVisible()
  await expect(page.locator('.hadley-textarea')).toHaveCount(0)
  expect(await marked(page)).toBe(true)
  await expect(page.getByRole('button', { name: 'Toggle edit mode', exact: true })).toBeEnabled()
})

test('a field opened while the page is fetched holds the change too', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await editMode(page)
  await page.waitForLoadState('networkidle')
  // review 2026-11-09: the hold was asked only before the fetch, and the block was swapped under the field. The
  // block's answer is on its way before the file changes; it arrives while the page is fetched.
  const hold = () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let reached!: () => void
    const there = new Promise<void>((resolve) => (reached = resolve))
    return { held, release, there, reached }
  }
  const answer = hold()
  await page.route('**/__hadley/block/*', async (route) => {
    const response = await route.fetch()
    answer.reached()
    await answer.held
    await route.fulfill({ response })
  })
  const refetch = hold()
  await page.route('**/panel/', async (route) => {
    refetch.reached()
    await refetch.held
    await route.continue()
  })
  await block(page, 'First words').click({ button: 'right' })
  await answer.there
  const original = await readFile(dev.source, 'utf8')
  await writeFile(dev.source, original.replace('Second block.', 'Second block, from outside.'))
  await refetch.there
  answer.release()
  await expect(page.locator('.hadley-textarea')).toBeVisible()
  refetch.release()
  await expect(page.getByRole('status').filter({ hasText: 'The page has changed' })).toBeVisible()
  await expect(block(page, 'Second block')).toHaveText(/^Second block\.$/)
  await page.keyboard.press('Escape')
  await expect(block(page, 'Second block')).toContainText('Second block, from outside.')
})
