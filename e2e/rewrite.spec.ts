import { test, expect } from './chat-fixture.ts'
import type { Locator, Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const screenshots = resolve('node_modules/.cache/chat-rewrite/screenshots')
const original = 'First words of the attached block.'

async function select(page: Page, start: number, end: number) {
  await page.locator('.hadley-textarea').evaluate(
    (field: { focus(): void; setSelectionRange(start: number, end: number): void }, range) => {
      field.focus()
      field.setSelectionRange(range.start, range.end)
    },
    { start, end },
  )
}

for (const lang of ['en', 'de']) {
  const t =
    lang === 'en'
      ? {
          edit: 'Toggle edit mode',
          rewrite: 'Rewrite',
          shorter: 'Shorter',
          clearer: 'Clearer',
          formal: 'More formal',
          block: 'Rewrite the block',
          selected: 'Rewrite the selection',
          scope: 'Selection · 5 characters',
          own: 'Only instructions',
          instruction: 'Instruction for Claude (at most 500 characters)',
          direction: 'Way to rewrite',
          undo: 'Undo',
          cancel: 'Cancel',
          sent: 'Sent',
          delivered: 'Delivered',
          waiting: /Waiting for [1-9][0-9]* s/,
          permission: 'Waiting for a permission',
          insert: 'Insert',
          copy: 'Copy',
          discard: 'Discard',
          applied: 'Inserted in the editing field',
          title: 'Chat with Claude',
        }
      : {
          edit: 'Edit-Modus umschalten',
          rewrite: 'Umschreiben',
          shorter: 'Kürzer',
          clearer: 'Klarer',
          formal: 'Formeller',
          block: 'Block umschreiben',
          selected: 'Auswahl umschreiben',
          scope: 'Auswahl · 5 Zeichen',
          own: 'Nur Anweisungen',
          instruction: 'Anweisung für Claude (höchstens 500 Zeichen)',
          direction: 'Art des Umschreibens',
          undo: 'Rückgängig',
          cancel: 'Abbrechen',
          sent: 'Gesendet',
          delivered: 'Zugestellt',
          waiting: /Warten seit [1-9][0-9]* s/,
          permission: 'Wartet auf eine Freigabe',
          insert: 'Einfügen',
          copy: 'Kopieren',
          discard: 'Verwerfen',
          applied: 'Ins Bearbeitungsfeld eingefügt',
          title: 'Chat mit Claude',
        }
  // the row's way to rewrite, chosen in its menu, sent with its button
  const rewriteAs = async (row: Locator, way: string) => {
    await row.getByRole('combobox', { name: t.direction, exact: true }).selectOption({ label: way })
    await row.locator('.hc-send').click()
  }
  const open = async (page: Page, origin: string) => {
    await page.goto(origin + (lang === 'en' ? '/panel/' : '/de/panel/'))
    await page.getByRole('button', { name: t.edit, exact: true }).click()
    await page
      .locator('[data-hadley-id]')
      .filter({ hasText: lang === 'en' ? 'First words' : 'Erste Wörter' })
      .first()
      .click({ button: 'right' })
    return page.locator('.hadley-textarea')
  }

  test(`${lang}: rewrites blocks and selections through native undo, shows states, duration and Details`, async ({
    page,
    dev,
  }, info) => {
    const channel = await dev.channel()
    const source = await readFile(dev.source, 'utf8')
    const field = await open(page, dev.origin)
    const draft = await field.inputValue()
    const row = page.locator('.hadley-rewrite')
    await field.fill(draft + ' Unsaved.')
    if (info.repeatEachIndex === 0) {
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: resolve(screenshots, `row-${lang}-${info.project.name}.png`) })
    }
    await rewriteAs(row, t.clearer)
    const action = (await channel.inbox.next((entry) => entry.event === 'message')).data as {
      id: string
      action: string
      direction: string
      draft: string
      selection?: { start: number; end: number }
    }
    expect(action.action).toBe('rewrite-block')
    expect(action.direction).toBe('clearer')
    expect(action.draft).toBe(draft + ' Unsaved.')
    await expect(row.locator('.hc-status-label')).toHaveText(t.sent)
    expect((await channel.send({ event: 'delivered', data: { id: action.id } })).status).toBe(200)
    await expect(row.locator('.hc-status-label')).toHaveText(t.delivered)
    await expect(row.locator('.hc-status-label')).toHaveText(t.waiting)
    expect(
      (
        await channel.send({
          request_id: 'abcde',
          tool: 'mcp__hadley__suggest',
          description: 'Propose text',
          preview: '',
        })
      ).status,
    ).toBe(200)
    await expect(row.locator('.hc-status-label')).toHaveText(t.permission)
    await field.focus()
    await expect(field).toBeEditable()
    expect(
      (await channel.send({ event: 'suggestion', data: { id: 'suggest1', to: action.id, text: 'A clearer *block*.' } }))
        .status,
    ).toBe(200)
    await expect(field).toHaveValue('A clearer *block*.')
    await expect(row.locator('.hc-status-label')).toHaveText(/In [0-9]+\.[0-9] s/)
    // done: a check, and Undo takes the proposal back as Ctrl+Z does
    await expect(row.locator('.hc-rewrite-state')).toHaveAttribute('data-state', 'done')
    await row.getByRole('button', { name: t.undo, exact: true }).click()
    await expect(field).toHaveValue(action.draft)
    await expect(row.getByRole('button', { name: t.undo, exact: true })).toBeHidden()
    await field.press('Control+Shift+z')
    await expect(field).toHaveValue('A clearer *block*.')
    await field.press('Control+z')
    await expect(field).toHaveValue(action.draft)
    const panel = page.locator('#hadley-chat')
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Chat', exact: true }).click()
    // the details belong to the large panel
    await panel.getByRole('button', { name: /^(Larger|Größer)/ }).click()
    await panel.getByRole('checkbox', { name: 'Details', exact: true }).check()
    const timeline = panel.locator('.hc-timeline').first()
    await expect(timeline).toBeVisible()
    await expect(timeline).toContainText(t.sent)
    await expect(timeline).toContainText(t.delivered)
    await expect(timeline).toContainText('mcp__hadley__suggest')
    await timeline.locator('summary').last().click()
    await expect(timeline.locator('pre').last()).toBeVisible()
    await expect(timeline.locator('pre').last()).toContainText('suggestion')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(row.locator('.hc-rewrite-scope')).toBeHidden()
    await expect(row.getByRole('button', { name: t.block, exact: true })).toBeVisible()
    await select(page, 0, 5)
    await field.press('Shift+ArrowRight')
    await field.press('Shift+ArrowLeft')
    await expect(row.locator('.hc-rewrite-scope')).toHaveText(t.scope)
    await expect(row.getByRole('button', { name: t.selected, exact: true })).toBeVisible()
    if (info.repeatEachIndex === 0)
      await page.screenshot({ path: resolve(screenshots, `selection-${lang}-${info.project.name}.png`) })
    await rewriteAs(row, t.shorter)
    // 2026-11-05: the click took the focus, and the browser no longer painted the selection
    await expect(field).toBeFocused()
    expect(
      await field.evaluate((node: { selectionStart: number; selectionEnd: number }) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([0, 5])
    const selection = (await channel.inbox.next((entry) => entry.event === 'message')).data as typeof action
    expect(selection.action).toBe('rewrite-selection')
    expect(selection.selection).toEqual({ start: 0, end: 5 })
    // Changes outside the selected range do not invalidate it.
    await select(page, selection.draft.length, selection.draft.length)
    await field.press('End')
    await field.press('!')
    expect(
      (await channel.send({ event: 'suggestion', data: { id: 'suggest2', to: selection.id, text: 'Brief' } })).status,
    ).toBe(200)
    await expect(field).toHaveValue('Brief' + selection.draft.slice(5) + '!')
    // what came back is selected, so that it shows
    expect(
      await field.evaluate((node: { selectionStart: number; selectionEnd: number }) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([0, 5])
    await expect(row.locator('.hc-send')).toBeEnabled()
    await field.press('Control+z')
    await expect(field).toHaveValue(selection.draft + '!')
    expect(await readFile(dev.source, 'utf8')).toBe(source)
    const duration = await panel.locator('.hc-request-state').first().textContent()
    const times = await timeline.locator('li > span').allTextContents()
    await page.reload()
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(panel.getByRole('checkbox', { name: 'Details', exact: true })).toBeChecked()
    const restored = await panel.locator('.hc-request-state').first().textContent()
    expect(parseFloat(restored!.slice(3))).toBeCloseTo(parseFloat(duration!.slice(3)), 0)
    await expect(timeline.locator('li > span').filter({ hasNotText: t.sent })).toHaveText(times.slice(1))
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await page
      .locator('[data-hadley-id]')
      .filter({ hasText: lang === 'en' ? 'First words' : 'Erste Wörter' })
      .first()
      .click({ button: 'right' })
    await expect(row.locator('.hc-send')).toBeEnabled()
  })

  test(`${lang}: keeps changed and closed blocks as fallback cards, inserts at current selection and undoes`, async ({
    page,
    dev,
  }, info) => {
    const channel = await dev.channel()
    const field = await open(page, dev.origin)
    const row = page.locator('.hadley-rewrite')
    const panel = page.locator('#hadley-chat')
    await rewriteAs(row, t.clearer)
    const action = (await channel.inbox.next((entry) => entry.event === 'message')).data as { id: string }
    await field.fill('Changed while waiting.')
    expect(
      (await channel.send({ event: 'suggestion', data: { id: 'suggest1', to: action.id, text: 'A proposal.' } }))
        .status,
    ).toBe(200)
    await expect(field).toHaveValue('Changed while waiting.')
    const card = panel.locator('.hc-proposal').first()
    await expect(card.getByRole('button', { name: t.insert, exact: true })).toBeVisible()
    if (info.repeatEachIndex === 0) {
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: resolve(screenshots, `fallback-${lang}-${info.project.name}.png`) })
    }
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: (text) => { document.documentElement.dataset.copied = text; return Promise.resolve() }
    } })`)
    await card.getByRole('button', { name: t.copy, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-copied', 'A proposal.')
    await select(page, 0, 7)
    await card.getByRole('button', { name: t.insert, exact: true }).click()
    await expect(field).toHaveValue('A proposal. while waiting.')
    await field.press('Control+z')
    await expect(field).toHaveValue('Changed while waiting.')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await select(page, 0, 7)
    await rewriteAs(row, t.formal)
    const selected = (await channel.inbox.next((entry) => entry.event === 'message')).data as { id: string }
    await field.fill('Selection changed.')
    expect(
      (await channel.send({ event: 'suggestion', data: { id: 'suggest2', to: selected.id, text: 'Formal.' } })).status,
    ).toBe(200)
    await expect(field).toHaveValue('Selection changed.')
    await panel.locator('.hc-proposal').last().getByRole('button', { name: t.discard, exact: true }).click()
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await rewriteAs(row, t.clearer)
    const closed = (await channel.inbox.next((entry) => entry.event === 'message')).data as { id: string }
    await page.locator('.hadley-editor').getByRole('button', { name: t.cancel, exact: true }).click()
    expect(
      (
        await channel.send({
          event: 'suggestion',
          data: { id: 'suggest3', to: closed.id, text: 'Closed block proposal.' },
        })
      ).status,
    ).toBe(200)
    await expect(field).toHaveCount(0)
    const last = panel.locator('.hc-proposal').last()
    await last.getByRole('button', { name: t.insert, exact: true }).click()
    await expect(last).toContainText(lang === 'en' ? 'Open a block first.' : 'Bitte zuerst einen Block öffnen.')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await page
      .locator('[data-hadley-id]')
      .filter({ hasText: lang === 'en' ? 'First words' : 'Erste Wörter' })
      .first()
      .click({ button: 'right' })
    await select(page, 0, 0)
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await last.getByRole('button', { name: t.insert, exact: true }).click()
    await expect(field).toHaveValue(
      'Closed block proposal.' + (lang === 'en' ? original : 'Erste Wörter des angehängten Blocks.'),
    )
    await field.press('Control+z')
    await expect(field).toHaveValue(lang === 'en' ? original : 'Erste Wörter des angehängten Blocks.')
  })

  test(`${lang}: keeps the browser's context menu, supports custom instructions and blocked storage`, async ({
    page,
    dev,
  }) => {
    const channel = await dev.channel()
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('storage blocked')
      }
      Storage.prototype.setItem = () => {
        throw new Error('storage blocked')
      }
    })
    const field = await open(page, dev.origin)
    await select(page, 0, 0)
    expect(
      await page.evaluate<boolean>(`document.querySelector('.hadley-textarea').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`),
    ).toBe(true)
    await select(page, 0, 5)
    await field.click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    const row = page.locator('.hadley-rewrite')
    await row.getByRole('combobox', { name: t.direction, exact: true }).selectOption({ label: t.own })
    const custom = row.getByRole('textbox', { name: t.instruction, exact: true })
    await expect(custom).toHaveAttribute('maxlength', '500')
    await custom.fill('Keep the tone.')
    await custom.press('Enter')
    const action = (await channel.inbox.next((entry) => entry.event === 'message')).data as {
      id: string
      instruction: string
      direction: string
    }
    expect(action.instruction).toBe('Keep the tone.')
    expect(action.direction).toBe('custom')
    await channel.send({ event: 'suggestion', data: { id: 'suggest1', to: action.id, text: 'Replacement.' } })
    await expect(field).toHaveValue('Replacement.')
    await select(page, 0, 5)
    await custom.fill('A warmer phrase.')
    await custom.press('Enter')
    const selected = (await channel.inbox.next((entry) => entry.event === 'message')).data as {
      id: string
      instruction: string
      selection: { start: number; end: number }
    }
    expect(selected.instruction).toBe('A warmer phrase.')
    await expect(custom).toHaveValue('A warmer phrase.')
    expect(selected.selection).toEqual({ start: 0, end: 5 })
    await channel.send({ event: 'suggestion', data: { id: 'suggest2', to: selected.id, text: 'Warm' } })
    await expect(field).toHaveValue('Warmcement.')

    // 2026-11-05: a way and a word of one's own at once, sent with Ctrl+Enter from the editing field
    await row.getByRole('combobox', { name: t.direction, exact: true }).selectOption({ label: t.shorter })
    await custom.fill('Keep the dry tone.')
    await field.press('Control+Enter')
    const both = (await channel.inbox.next((entry) => entry.event === 'message')).data as {
      direction: string
      instruction: string
    }
    expect(both.direction).toBe('shorter')
    expect(both.instruction).toBe('Keep the dry tone.')
  })
  test(`${lang}: retains fast events before HTTP acceptance and never applies to a reopened block`, async ({
    page,
    dev,
  }) => {
    const channel = await dev.channel()
    const field = await open(page, dev.origin)
    const draft = await field.inputValue()
    const row = page.locator('.hadley-rewrite')
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/__hadley/chat?*', async (route) => {
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })
    try {
      await rewriteAs(row, t.clearer)
      const action = (await channel.inbox.next((entry) => entry.event === 'message')).data as { id: string }
      await channel.send({ event: 'delivered', data: { id: action.id } })
      await channel.send({ request_id: 'abcde', tool: 'mcp__hadley__suggest', description: 'Propose', preview: '' })
      await expect(row.locator('.hc-status-label')).toHaveText(t.permission)
      await channel.send({ event: 'suggestion', data: { id: 'suggest1', to: action.id, text: 'Fast proposal.' } })
      await expect(page.locator('.hc-proposal')).toHaveCount(1)
      release()
      await expect(field).toHaveValue('Fast proposal.')
      await expect(row.locator('.hc-send')).toBeEnabled()
      await field.press('Control+z')
      await expect(field).toHaveValue(draft)
      await page.unroute('**/__hadley/chat?*')
      await rewriteAs(row, t.clearer)
      const closed = (await channel.inbox.next((entry) => entry.event === 'message')).data as { id: string }
      await page.locator('.hadley-editor').getByRole('button', { name: t.cancel, exact: true }).click()
      await page
        .locator('[data-hadley-id]')
        .filter({ hasText: lang === 'en' ? 'First words' : 'Erste Wörter' })
        .first()
        .click({ button: 'right' })
      await channel.send({ event: 'suggestion', data: { id: 'suggest2', to: closed.id, text: 'Old editor proposal.' } })
      await expect(field).toHaveValue(draft)
      await expect(
        page.locator('.hc-proposal').last().getByRole('button', { name: t.insert, exact: true }),
      ).toBeVisible()
    } finally {
      release()
    }
  })
}
