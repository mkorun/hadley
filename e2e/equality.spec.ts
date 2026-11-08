// The editor being rebuilt (addons/editor/browser/) against the old one (assets/editor.js), state by state: the same
// pixels, byte for byte, the same DOM (its elements, attributes and text, whitespace between elements aside), the same
// focus and field. Two runs: without HADLEY_EDITOR it records the old editor, with HADLEY_EDITOR=next it compares the
// new one with that record. Only under HADLEY_EQUALITY=1:
//
//   HADLEY_EQUALITY=1 bunx playwright test e2e/equality.spec.ts
//   HADLEY_EQUALITY=1 HADLEY_EDITOR=next bunx playwright test e2e/equality.spec.ts
import { test, expect } from './chat-fixture.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'

test.skip(process.env['HADLEY_EQUALITY'] !== '1', 'compares the two editors only when asked to')

const next = process.env['HADLEY_EDITOR'] === 'next'
const record = (browser: string) => join(tmpdir(), 'hadley-editor-equality', browser)

const PAGE = `---
publishFrom: 2026-01-01
---
# Equal

__The same page for both editors__

First paragraph, with *emphasis* and a [link](https://example.com).

Second paragraph.

## A heading

- one
- two

\`\`\`js
const a = 1
\`\`\`

---

Last paragraph.
`

// PNGs of one pixel, a grey one and a black one (as upload.spec.ts)
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const BLACK =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYGAAAAAEAAGjChXjAAAAAElFTkSuQmCC'

// The page as the editor left it: its body's elements, attributes sorted, block IDs by their order; then focus and
// the field. A script in the page, as text: the repository's TypeScript knows no DOM.
const SNAPSHOT = `(() => {
  const ids = new Map()
  const block = (id) => {
    if (!ids.has(id)) ids.set(id, 'block-' + ids.size)
    return ids.get(id)
  }
  const value = (name, raw) => {
    if (name === 'data-hadley-id') return block(raw)
    // a picture's preview has an address of its own in each run, a file of the bundle its block's
    if (raw.startsWith('blob:')) return 'blob:'
    return raw.replace(/^\\/__hadley\\/files\\/([^/]+)\\//, (_, id) => '/__hadley/files/' + block(id) + '/')
  }
  const lines = []
  const walk = (node, depth) => {
    const pad = '  '.repeat(depth)
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) lines.push(pad + JSON.stringify(node.textContent))
      return
    }
    if (!(node instanceof Element)) return
    const attributes = [...node.attributes].map((a) => a.name + '=' + JSON.stringify(value(a.name, a.value))).sort()
    lines.push(pad + '<' + node.localName + (attributes.length ? ' ' + attributes.join(' ') : '') + '>')
    for (const child of node.childNodes) walk(child, depth + 1)
  }
  walk(document.body, 0)
  const focused = document.activeElement
  const field = document.querySelector('.hadley-textarea')
  lines.push('focus: ' + (focused ? focused.localName + (focused.className ? '.' + focused.className : '') : 'none'))
  lines.push('field: ' + (field ? JSON.stringify([field.value, field.selectionStart, field.selectionEnd]) : 'none'))
  return lines.join('\\n') + '\\n'
})()`

/** Two frames of the browser: the editor's frames are placed, and nothing waits on a frame. */
const settle = async (page: Page) => {
  await page.evaluate(() => {
    const { requestAnimationFrame: frame } = globalThis as unknown as { requestAnimationFrame(next: () => void): void }
    return new Promise((resolve) => frame(() => frame(() => resolve(undefined))))
  })
}

const states: [string, (page: Page) => Promise<void>][] = [
  ['off', async () => {}],
  [
    'on',
    async (page) => {
      await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
    },
  ],
  [
    'hover',
    async (page) => {
      await page.getByText('Second paragraph.').hover()
    },
  ],
  [
    'menu',
    async (page) => {
      const block = page.locator('[data-hadley-id]').filter({ hasText: 'Second paragraph.' })
      await block.hover()
      await block.locator('.hadley-trigger').focus()
      await page.mouse.move(0, 0)
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('menuitem', { name: 'Move block down', exact: true })).toBeVisible()
    },
  ],
  [
    'rule',
    async (page) => {
      await page.keyboard.press('Escape')
      await page.locator('hr[data-hadley-id]').hover()
      await expect(page.locator('.hadley-trigger.is-visible')).toHaveCount(1)
    },
  ],
  [
    'dialog',
    async (page) => {
      const block = page.locator('[data-hadley-id]').filter({ hasText: 'Last paragraph.' })
      await block.hover()
      await block.locator('.hadley-trigger').hover()
      await page.getByRole('menuitem', { name: 'Delete block', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.waitForTimeout(400) // its animation
    },
  ],
  [
    'field',
    async (page) => {
      await page.keyboard.press('Escape')
      await page.mouse.move(0, 0)
      await page.getByText('First paragraph').click({ button: 'right' })
      await expect(page.locator('.hadley-files .hadley-file')).toHaveCount(2)
      await page.waitForTimeout(400)
    },
  ],
  [
    'picture',
    async (page) => {
      await page.locator('.hadley-textarea').evaluate((field: { dispatchEvent(event: unknown): boolean }, base64) => {
        // the browser's own constructors, which the repository's TypeScript (no DOM) does not know
        const { DataTransfer, File, DragEvent } = globalThis as unknown as {
          DataTransfer: new () => { items: { add(file: unknown): void } }
          File: new (parts: unknown[], name: string, options: { type: string }) => unknown
          DragEvent: new (type: string, init: object) => unknown
        }
        const data = new DataTransfer()
        data.items.add(
          new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'New Chart.png', {
            type: 'image/png',
          }),
        )
        const init = { bubbles: true, cancelable: true, dataTransfer: data }
        field.dispatchEvent(new DragEvent('dragover', init))
        field.dispatchEvent(new DragEvent('drop', init))
      }, PIXEL)
      await expect(page.locator('form.hadley-add')).toBeVisible()
      await page.waitForTimeout(400)
    },
  ],
  [
    'front-matter',
    async (page) => {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.locator('.hadley-front-matter-badge').click()
      await expect(page.locator('.hadley-fm')).toBeVisible()
      await page.waitForTimeout(400)
    },
  ],
]

for (const scheme of ['light', 'dark'] as const)
  for (const width of [1280, 390])
    test(`the same in each state: ${scheme}, ${width} px`, async ({ page, dev, browserName }) => {
      const bundle = join(dirname(dirname(dev.source)), '[equal]')
      await dev.rebuild(async () => {
        await mkdir(bundle, { recursive: true })
        await writeFile(join(bundle, 'equal.md'), PAGE)
        await writeFile(join(bundle, 'chart.png'), Buffer.from(BLACK, 'base64'))
        await writeFile(join(bundle, 'notes.txt'), 'notes\n')
      })
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.setViewportSize({ width, height: 900 })
      // the bundle's new files may rebuild the page once more, and reload it: on only once it stays
      let navigated = true
      page.on('framenavigated', () => (navigated = true))
      await page.goto(dev.origin + '/equal/')
      while (navigated) {
        navigated = false
        await page.waitForTimeout(1000)
      }
      await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).waitFor()
      await page.evaluate('document.fonts.ready.then(() => undefined)')
      const dir = join(record(browserName), `${scheme}-${width}`)
      await mkdir(join(dir, next ? 'next' : 'old'), { recursive: true })
      const differ: string[] = []
      for (const [name, reach] of states) {
        await reach(page)
        await settle(page)
        const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })
        const dom = await page.evaluate<string>(SNAPSHOT)
        await writeFile(join(dir, next ? 'next' : 'old', `${name}.png`), shot)
        await writeFile(join(dir, next ? 'next' : 'old', `${name}.txt`), dom)
        if (!next) continue
        const old = (file: string) => readFile(join(dir, 'old', file)).catch(() => undefined)
        const [oldShot, oldDom] = await Promise.all([old(`${name}.png`), old(`${name}.txt`)])
        if (!oldShot || !oldDom)
          throw new Error(`no record of the old editor in ${dir}: run without HADLEY_EDITOR first`)
        if (!oldShot.equals(shot)) differ.push(`${name}.png`)
        if (oldDom.toString() !== dom) differ.push(`${name}.txt`)
      }
      // the files beside each other in `dir`, old/ and next/, for a look at what differs
      expect(differ, dir).toEqual([])
    })
