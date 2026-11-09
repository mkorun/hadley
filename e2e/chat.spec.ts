import { test, expect } from './chat-fixture.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const screenshots = resolve('node_modules/.cache/chat-panel/screenshots')
const editorEntry = '/__hadley/editor/main.ts'

test('opens, closes, preserves the draft and stays usable without a session or storage', async ({
  page,
  dev,
  context,
}) => {
  await page.goto(dev.origin + '/panel/')
  const toggle = page.getByRole('button', { name: 'Chat', exact: true })
  // no session has named itself yet: the panel speaks of the AI
  const panel = page.getByRole('region', { name: 'Chat with AI', exact: true })
  const input = page.getByRole('textbox', { name: 'Message to AI', exact: true })
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(input).toBeFocused()
  await expect(panel).toContainText('No agent connected.')
  // the agents the dev server can start, as the user configuration names them (chat-fixture.ts)
  await expect(panel.getByRole('button', { name: 'Start Claude Code', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Start Codex', exact: true })).toBeVisible()
  await input.fill('An unsent draft')
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.reload()
  await expect(input).toHaveValue('An unsent draft')
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await toggle.click()
  await expect(panel).toBeHidden()
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('storage blocked')
    }
  })
  await page.reload()
  await toggle.click()
  await input.fill('Still writable')
  await expect(input).toHaveValue('Still writable')
  await page.keyboard.press('Escape')
  await expect(toggle).toBeFocused()
})

test('keeps a draft over a rebuild, sends the page and root, renders replies safely, answers distinct cards and reloads', async ({
  page,
  dev,
}) => {
  const channel = await dev.channel()
  await page.goto(dev.origin + '/panel/')
  const panel = page.getByRole('region', { name: 'Chat with Claude' })
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(input).toBeFocused()
  await input.fill('Explain this')
  await input.press('Shift+Enter')
  await input.press('x')
  await expect(input).toHaveValue('Explain this\nx')
  const block = page.locator('[data-hadley-id]').filter({ hasText: 'First words' }).first()
  const oldId = await block.getAttribute('data-hadley-id')
  await dev.rebuild(async () => {
    await writeFile(dev.source, (await readFile(dev.source, 'utf8')) + '\nAnother block after an editor change.\n')
  })
  await expect.poll(() => block.getAttribute('data-hadley-id')).not.toBe(oldId)
  await expect(input).toHaveValue('Explain this\nx')
  await input.press('Enter')
  const received = await channel.inbox.next((entry) => entry.event === 'message')
  const message = received.data as { id: string; root: string; url: string; block?: string }
  expect(message.root).toBe(dev.site)
  expect(new URL(message.url).pathname).toBe('/panel/')
  // the panel attaches no block: only an action from an open block names one
  expect(message.block).toBeUndefined()
  await expect(panel.locator('.hc-message')).toHaveText('Explain this\nx')
  await expect(input).toHaveValue('')
  expect(
    (
      await channel.send({
        id: 'reply001',
        to: message.id,
        text: 'A paragraph with `code` and [a link](https://example.org/).\n\n```html\n<b>literal</b>\n```\n\n<script>window.chatInjected = true</script> [bad](javascript:alert(1))',
      })
    ).status,
  ).toBe(200)
  const reply = panel.locator('.hc-thread .hc-reply')
  await expect(reply).toContainText('<script>window.chatInjected = true</script>')
  await expect(reply.locator('script, b')).toHaveCount(0)
  await expect(reply.locator('pre code')).toHaveText('<b>literal</b>')
  await expect(reply.locator('a')).toHaveCount(1)
  await expect(reply.locator('a')).toHaveAttribute('href', 'https://example.org/')
  await expect(reply.locator('a')).toHaveAttribute('target', '_blank')
  await expect(reply.locator('a')).toHaveAttribute('rel', 'noopener noreferrer')
  expect(
    (
      await channel.send({
        request_id: 'abcde',
        tool: 'Read',
        description: 'Read the source',
        preview: 'file: panel.md\n'.repeat(25),
      })
    ).status,
  ).toBe(200)
  const cards = panel.locator('.hc-permission')
  await expect(cards).toHaveCount(1)
  await expect(cards.first().getByRole('heading', { name: 'Read', exact: true })).toBeVisible()
  await expect(cards.first().locator('details')).not.toHaveAttribute('open')
  await cards.first().getByRole('button', { name: 'Allow', exact: true }).click()
  expect((await channel.inbox.next((entry) => entry.event === 'verdict')).data).toEqual({
    request_id: 'abcde',
    allow: true,
  })
  await expect(cards.first()).toContainText('Answered: Allow')
  expect(
    (
      await channel.send({
        request_id: 'bcdef',
        tool: 'mcp__hadley__reply',
        description: 'Send the answer',
        preview: 'An answer',
      })
    ).status,
  ).toBe(200)
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(1).getByRole('heading', { name: 'mcp__hadley__reply' })).toBeVisible()
  await expect(cards.nth(1)).toContainText('Newest open request')
  await expect(cards.first()).not.toContainText('Newest open request')
  await cards.nth(1).getByRole('button', { name: 'Deny', exact: true }).click()
  expect((await channel.inbox.next((entry) => entry.event === 'verdict')).data).toEqual({
    request_id: 'bcdef',
    allow: false,
  })
  await expect(cards.nth(1)).toContainText('Answered: Deny')
  await page.reload()
  await expect(panel.locator('.hc-message')).toHaveCount(1)
  await expect(panel.locator('.hc-reply')).toHaveCount(1)
  await expect(cards).toHaveCount(2)
  await expect(cards.getByRole('button')).toHaveCount(0)
  await expect(cards.first()).toContainText('Answered')
})

test('shows verdict conflicts, keeps drafts after server errors, and follows channel status', async ({ page, dev }) => {
  const channel = await dev.channel()
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  const panel = page.locator('#hadley-chat')
  const input = page.getByRole('textbox', { name: 'Message to Claude' })
  await expect(panel.locator('.hc-status')).toHaveText('Claude Code connected')
  expect((await channel.send({ request_id: 'abcde', tool: 'Read', description: 'Read', preview: '{}' })).status).toBe(
    200,
  )
  // Another browser/terminal answers first; the panel discovers that through the contracted 409.
  expect(
    (
      await page.request.post(dev.origin + '/__hadley/chat/verdict', {
        headers: { Origin: dev.origin, 'X-Hadley-Key': dev.key().key },
        data: { request_id: 'abcde', allow: true },
      })
    ).status(),
  ).toBe(200)
  await panel.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(panel.locator('.hc-permission')).toContainText('Answered elsewhere')
  for (const status of [400, 409, 503]) {
    await page.route('**/__hadley/chat?*', (route) => route.fulfill({ status, json: { error: 'rejected' } }))
    await input.fill('Keep my draft')
    await input.press('Enter')
    await expect(panel.locator('.hc-error')).toContainText(
      status === 400 ? 'server rejected' : status === 409 ? 'Reload the page first' : 'No agent connected',
    )
    await expect(input).toHaveValue('Keep my draft')
    await page.unroute('**/__hadley/chat?*')
  }
  channel.close()
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(panel.locator('.hc-offline')).toBeVisible()
  await dev.channel()
  await expect(panel.locator('.hc-status')).toHaveText('Claude Code connected')
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
})

test('reconnects its event stream without duplicating history, including across a dev restart', async ({
  page,
  dev,
}) => {
  let channel = await dev.channel()
  // Keep Vite's own reload from hiding an EventSource reconnection failure.
  await page.route('**/@vite/client', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  const replies = page.locator('#hadley-chat .hc-reply')
  expect((await channel.send({ id: 'reply001', text: 'Only once' })).status).toBe(200)
  await expect(replies).toHaveCount(1)
  // Force the real stream to reconnect against the same server and receive the same history again.
  await page.evaluate("window.dispatchEvent(new Event('pagehide'))")
  await page.reload()
  await expect(replies).toHaveCount(1)
  channel.close()
  await dev.restart()
  await expect(page.locator('#hadley-chat .hc-offline')).toBeVisible({ timeout: 15_000 })
  channel = await dev.channel()
  await expect(page.locator('#hadley-chat .hc-status')).toHaveText('Claude Code connected', { timeout: 15_000 })
  expect((await channel.send({ id: 'reply002', text: 'After restart' })).status).toBe(200)
  await expect(replies).toHaveCount(1)
  await expect(replies).toContainText('After restart')
})

test('uses both page languages and the editor colours, at desktop and 390px without covering controls', async ({
  page,
  dev,
}) => {
  const channel = await dev.channel()
  await mkdir(screenshots, { recursive: true })
  expect(
    (
      await channel.send({
        id: 'reply001',
        text: 'A reply with `inline code`.\n\n```html\n<p>Text stays text.</p>\n```',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await channel.send({
        request_id: 'abcde',
        tool: 'Read',
        description: 'Read the attached source block',
        preview: 'content/articles/[panel]/panel.md',
      })
    ).status,
  ).toBe(200)
  for (const lang of ['en', 'de']) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(dev.origin + (lang === 'de' ? '/de/panel/' : '/panel/'))
        // the editor's language, as its switch keeps it (addons/editor/browser/core/texts.ts)
        await page.evaluate((chosen) => globalThis.localStorage.setItem('hadley-lang', chosen), lang)
        await page.reload()
        const toggle = page.getByRole('button', { name: 'Chat', exact: true })
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
        const panel = page.locator('#hadley-chat')
        await expect(panel).toContainText(lang === 'de' ? 'Chat mit Claude' : 'Chat with Claude')
        await expect(panel).toContainText(lang === 'de' ? 'Claude Code verbunden' : 'Claude Code connected')
        // measured once the panel has risen into place (chat.css, its opening)
        await panel.evaluate((node) =>
          Promise.all(node.getAnimations().map((animation: { finished: Promise<unknown> }) => animation.finished)),
        )
        const rect = await panel.boundingBox()
        const bar = await page.locator('#hadley-chat-toggle').boundingBox()
        expect(rect!.y + rect!.height).toBeLessThan(bar!.y)
        // compact, a card above the control; on a phone, a sheet across the width
        expect(Math.round(rect!.width)).toBe(width === 390 ? 390 : 320)
        const colours = await panel.evaluate((node) => ({
          bg: node.ownerDocument.defaultView!.getComputedStyle(node).backgroundColor,
          editor: node.ownerDocument.defaultView!.getComputedStyle(node.ownerDocument.querySelector('.hadley-pill')!)
            .backgroundColor,
        }))
        expect(colours.bg).toBe(colours.editor)
        await page.screenshot({ path: `${screenshots}/${lang}-${scheme}-${width}.png` })
        // large, a panel beside the page, and back
        await panel
          .getByRole('button', { name: lang === 'de' ? 'Größer: neben der Seite' : 'Larger: beside the page' })
          .click()
        await panel.evaluate((node) =>
          Promise.all(node.getAnimations().map((animation: { finished: Promise<unknown> }) => animation.finished)),
        )
        expect(Math.round((await panel.boundingBox())!.width)).toBe(width === 390 ? 390 : 352)
        await page.screenshot({ path: `${screenshots}/${lang}-${scheme}-${width}-large.png` })
        await panel.getByRole('button', { name: lang === 'de' ? 'Kleiner: als Karte' : 'Smaller: a card' }).click()
      }
    }
  }
  channel.close()
})

test('includes assets after the editor only when chat is enabled', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  expect(
    await page
      .locator('head script[src^="/__hadley/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src'))),
  ).toEqual(['/__hadley/editor/refresh/index.ts', editorEntry])
  // the chat is a feature of the editor's, which loads it where the page is marked for it
  await expect(page.locator('meta[name="hadley-chat"]')).toHaveCount(1)
  await expect(page.locator('#hadley-chat-toggle')).toHaveCount(1)
  for (const [file, type] of [
    ['editor/features/chat/index.ts', 'javascript'],
    ['chat.css', 'text/css'],
  ]) {
    const response = await page.request.get(dev.origin + '/__hadley/' + file)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain(type)
  }
  // Leave Vite's old connection so the fixture receives the next startup reload first.
  await page.goto('about:blank')
  await dev.restart(async () => {
    await writeFile(dev.config, (await readFile(dev.config, 'utf8')).replace('chat: true', 'chat: false'))
  })
  await page.goto(dev.origin + '/panel/')
  await expect(page.locator('meta[name="hadley-chat"], link[href="/__hadley/chat.css"], #hadley-chat')).toHaveCount(0)
  await page.locator('[data-hadley-id]').first().click({ button: 'right' })
  await expect(page.locator('.hadley-rewrite')).toHaveCount(0)
})

test('HTTP: real dev serves the assets and relays block context, replies and verdicts through rendezvous', async ({
  dev,
  request,
}) => {
  const page = await request.get(dev.origin + '/panel/')
  expect(page.status()).toBe(200)
  const html = await page.text()
  expect(html).toContain('<meta name="hadley-chat"')
  expect(html).toContain('/__hadley/chat.css')
  for (const [asset, type] of [
    ['editor/features/chat/index.ts', 'javascript'],
    ['chat.css', 'text/css'],
  ]) {
    const response = await request.get(dev.origin + '/__hadley/' + asset)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain(type)
  }
  const german = await request.get(dev.origin + '/de/panel/')
  expect(german.status()).toBe(200)
  expect(await german.text()).toContain('lang="de"')
  const block = /data-hadley-id="([^"]+)"[^>]*>First words/.exec(html)?.[1]
  expect(block).toBeTruthy()
  // a request with the site's key, as the panel sends it after the link (browser-key.ts)
  const key = dev.key()
  const headers = { Origin: dev.origin, 'X-Hadley-Key': key.key }
  const send = () =>
    request.post(dev.origin + '/__hadley/chat', { headers, data: { text: 'Explain', page: '/panel/', block } })
  expect((await send()).status()).toBe(503)
  const channel = await dev.channel()
  const response = await send()
  expect(response.status()).toBe(200)
  const data = (await channel.inbox.next((entry) => entry.event === 'message')).data as {
    id: string
    root: string
    file: string
    lines: string
  }
  expect(data.root).toBe(dev.site)
  expect(data.file).toBe('content/articles/[panel]/panel.md')
  expect(data.lines).toBe('5-5')
  expect((await channel.send({ id: 'reply001', to: data.id, text: '<script>literal</script>' })).status).toBe(200)
  expect((await channel.send({ request_id: 'abcde', tool: 'Read', description: 'Source', preview: '{}' })).status).toBe(
    200,
  )
  const verdict = await request.post(dev.origin + '/__hadley/chat/verdict', {
    headers,
    data: { request_id: 'abcde', allow: true },
  })
  expect(verdict.status()).toBe(200)
  expect((await channel.inbox.next((entry) => entry.event === 'verdict')).data).toEqual({
    request_id: 'abcde',
    allow: true,
  })
})

test('a browser without the key gets no chat, and the link gives it the key', async ({ browser, dev }) => {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(dev.origin + '/panel/')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.locator('#hadley-chat .hc-error')).toContainText('open the link hadley dev printed')
    // the request a local program could send is refused as well
    const refused = await page.request.post(dev.origin + '/__hadley/chat', {
      headers: { Origin: dev.origin },
      data: { text: 'hello', page: '/panel/' },
    })
    expect(refused.status()).toBe(401)
    // the link: its page keeps the key and goes on to the site's home, with nothing of the key left in the address
    await page.goto(`${dev.origin}/__hadley/chat/unlock#${dev.key().key}`)
    await expect.poll(() => page.url()).toBe(`${dev.origin}/`)
    await page.goto(dev.origin + '/panel/')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page.locator('#hadley-chat .hc-error')).toBeEmpty()
    // a link with another key, from any page, replaces nothing: the unlock page keeps only a key the server took
    await page.goto(`${dev.origin}/__hadley/chat/unlock#${'f'.repeat(64)}`)
    await expect.poll(() => page.url()).toBe(`${dev.origin}/`)
    await page.goto(dev.origin + '/panel/')
    await page.getByRole('button', { name: 'Chat', exact: true }).click()
    // the panel still holds the right key: its event stream answers, no session is connected in this test
    await expect(page.locator('#hadley-chat .hc-status')).toHaveText('No agent connected.')
  } finally {
    await context.close()
  }
})

// Michael, 2026-11-09: the closed panel flashed up on each load, as when the language switches
test('the closed panel is never shown while the page loads', async ({ page, dev }) => {
  // a script of the page, as text: e2e has no DOM types
  await page.addInitScript(`
    const seen = []
    window.panelSeen = seen
    new MutationObserver(() => {
      const panel = document.getElementById('hadley-chat')
      if (panel) seen.push(!panel.hidden)
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  `)
  await page.goto(dev.origin + '/panel/')
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible()
  const seen = await page.evaluate('window.panelSeen')
  expect(seen).not.toContain(true)
})
