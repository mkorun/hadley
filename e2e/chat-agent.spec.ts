// The agent the dev server starts itself (addons/chat/agents.ts), from the panel: a stand-in for Claude Code
// (chat-fixture.ts) starts, answers, asks before a tool, takes a new conversation and stops; a channel cannot join it.
import { test, expect } from './chat-fixture.ts'

test('starts an agent from the panel, talks with it, and stops it', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  const panel = page.locator('#hadley-chat')
  const input = page.getByRole('textbox', { name: /^Message to / })
  await panel.getByRole('button', { name: 'Start Claude Code', exact: true }).click()
  await expect(panel.locator('.hc-status')).toHaveText('Claude Code connected')
  await expect(panel.locator('.hc-offline')).toBeHidden()
  await expect(panel.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible()

  await input.fill('hello')
  await input.press('Enter')
  await expect(panel.locator('.hc-reply').last()).toContainText('echo: hello')

  // a tool waits for the author, here denied
  await input.fill('TOOL')
  await input.press('Enter')
  const permission = panel.locator('.hc-permission').last()
  await expect(permission).toContainText('ls -1')
  await permission.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(panel.locator('.hc-reply').last()).toContainText('denied')

  // a new conversation: the old one stops, a new one begins
  await panel.getByRole('button', { name: 'New conversation', exact: true }).click()
  await expect(panel.locator('.hc-notice').last()).toHaveText('New conversation begun.', { timeout: 15_000 })

  await panel.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(panel.locator('.hc-notice').last()).toHaveText('Claude Code stopped.')
  await expect(panel.locator('.hc-status')).toHaveText('No agent connected.')
  await expect(panel.getByRole('button', { name: 'Start Codex', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'New conversation', exact: true })).toBeHidden()
})
