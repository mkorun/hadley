// The dev server runs older code than lies on the disk (lib/code-stamp.ts; Michael, 2026-11-09): a standing warning
// above the pill says so; an older server, which knows no such route, says so by its answer.
import { test, expect } from './chat-fixture.ts'

const warning = 'The dev server runs older code. Please restart it.'

test('no warning while the dev server runs the code on the disk', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await expect(page.locator('#hadley-edit-toggle')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole('alert').filter({ hasText: warning })).toHaveCount(0)
})

test('a warning while it runs older code, or knows no such question', async ({ page, dev }) => {
  await page.route('**/__hadley/stale*', (route) => route.fulfill({ json: { stale: true } }))
  await page.goto(dev.origin + '/panel/')
  await expect(page.getByRole('alert').filter({ hasText: warning })).toBeVisible()
  await page.unroute('**/__hadley/stale*')
  await page.route('**/__hadley/stale*', (route) => route.fulfill({ status: 404, json: { error: 'not found' } }))
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: warning })).toBeVisible()
})
