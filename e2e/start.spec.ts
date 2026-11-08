// How the editor being rebuilt starts (addons/editor/browser/main.ts): its stylesheet first, then the editor, and only
// then the chat, which looks for the editor's bar; served as JavaScript from TypeScript (browser-files.ts). Only under
// HADLEY_EDITOR=next, as the suite runs against the new editor.
import { test, expect } from './chat-fixture.ts'

test.skip(process.env['HADLEY_EDITOR'] !== 'next', 'the start of the editor being rebuilt')

test('the chat loads only after the stylesheet, however long that takes', async ({ page, dev }) => {
  const order: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/__hadley/chat.js')) order.push('chat requested')
  })
  await page.route('**/__hadley/editor/editor.css', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    order.push('stylesheet answered')
    await route.continue()
  })
  await page.goto(dev.origin + '/panel/')
  await expect.poll(() => order).toEqual(['stylesheet answered', 'chat requested'])
})

test('the editor is served as JavaScript, the stylesheet as CSS, and nothing else under its path', async ({ dev }) => {
  const main = await fetch(dev.origin + '/__hadley/editor/main.ts')
  expect(main.status).toBe(200)
  expect(main.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
  expect(await main.text()).toContain('sourceMappingURL=data:application/json;base64,')
  const css = await fetch(dev.origin + '/__hadley/editor/editor.css')
  expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8')
  for (const path of ['tsconfig.json', '../plugin.ts', '%2e%2e/plugin.ts', 'missing.ts'])
    expect((await fetch(dev.origin + '/__hadley/editor/' + path)).status, path).toBe(404)
})
