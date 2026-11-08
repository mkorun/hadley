// How the editor being rebuilt starts (addons/editor/browser/main.ts): where the old one stood, its stylesheet before
// it and the chat's script after it, so that the chat finds the editor's bar however long the stylesheet takes; served
// as JavaScript from TypeScript (browser-files.ts). Only under HADLEY_EDITOR=next, as the suite runs against it.
import { test, expect } from './chat-fixture.ts'

test.skip(process.env['HADLEY_EDITOR'] !== 'next', 'the start of the editor being rebuilt')

test("the chat finds the editor's bar, however long the stylesheet takes", async ({ page, dev }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/__hadley/editor/editor.css', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.goto(dev.origin + '/panel/')
  await expect(
    page.locator('#hadley-dev-bar .hadley-pill').getByRole('button', { name: 'Chat', exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
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
