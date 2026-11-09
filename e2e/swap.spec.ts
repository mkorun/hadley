// The swap itself (addons/editor/browser/refresh/swap.ts), run in the page on documents made from strings: what the
// live page cannot take in place stays a reload (review 2026-11-09).
import { test, expect } from './chat-fixture.ts'
import type { Page } from '@playwright/test'

const html = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const blocks = (a: string, b: string, attrs = '') =>
  `<main${attrs}><p data-hadley-id="${a}">First.</p><p data-hadley-id="${b}">Second.</p></main>`

const run = async (page: Page, dev: { origin: string }, live: string, before: string, after: string) => {
  await page.goto(dev.origin + '/panel/')
  return (await page.evaluate(`(async () => {
    const { swap } = await import('/__hadley/editor/refresh/swap.ts')
    const parse = (text) => new DOMParser().parseFromString(text, 'text/html')
    const live = parse(${JSON.stringify(live)})
    const result = swap(live, parse(${JSON.stringify(before)}), parse(${JSON.stringify(after)}))
    const ids = [...live.querySelectorAll('[data-hadley-id]')].map((e) => e.textContent + '=' + e.getAttribute('data-hadley-id'))
    return { kind: result.kind, ids, div: live.querySelector('div')?.innerHTML ?? '' }
  })()`)) as { kind: string; ids: string[]; div: string }
}

test('blocks a script moved are not given each other’s ids: a reload', async ({ page, dev }) => {
  const before = html('<title>A</title>', blocks('1', '2'))
  const after = html('<title>B</title>', blocks('3', '4'))
  const moved = html(
    '<title>A</title>',
    '<main><p data-hadley-id="2">Second.</p><p data-hadley-id="1">First.</p></main>',
  )
  expect((await run(page, dev, moved, before, after)).kind).toBe('reload')
  // as the server sent it, each block takes its new id in place
  expect(await run(page, dev, before, before, after)).toMatchObject({ kind: 'done', ids: ['First.=3', 'Second.=4'] })
})

test('the text beside an element’s children follows; the content’s own attributes ask for a reload', async ({
  page,
  dev,
}) => {
  const head = '<title>T</title>'
  const before = html(head, `<div>Panel <span>Panel</span></div>${blocks('1', '2')}`)
  const after = html(head, `<div>Changed <span>Changed</span></div>${blocks('1', '2')}`)
  expect(await run(page, dev, before, before, after)).toMatchObject({
    kind: 'done',
    div: 'Changed <span>Changed</span>',
  })
  const attributed = (title: string) => html(head, blocks('1', '2', ` data-title="${title}"`))
  expect((await run(page, dev, attributed('Panel'), attributed('Panel'), attributed('Changed'))).kind).toBe('reload')
})

test('JSON-LD that becomes a script that runs asks for a reload', async ({ page, dev }) => {
  const before = html('<script type="application/ld+json">{}</script>', blocks('1', '2'))
  const after = html('<script>window.ran = 1</script>', blocks('1', '2'))
  expect((await run(page, dev, before, before, after)).kind).toBe('reload')
})
