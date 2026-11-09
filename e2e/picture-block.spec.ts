// A picture of the page's bundle is a block of the editor (case/markanto-native-renderer.ts, bundleImageHtml): it had
// no id, so no frame and no field (Michael, 2026-11-09).
import { test, expect } from './chat-fixture.ts'
import { PIXEL, editMode } from './editor.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

test('a sized picture of the bundle opens its Markdown in the field', async ({ page, dev }) => {
  await writeFile(join(dirname(dev.source), 'dot.png'), Buffer.from(PIXEL, 'base64'))
  await writeFile(dev.source, (await readFile(dev.source, 'utf8')) + '\n<m data-size=50%>![A grey dot](dot.png)</m>\n')
  await page.goto(dev.origin + '/panel/')
  const picture = page.locator('figure[data-hadley-id]').filter({ has: page.locator('img[alt="A grey dot"]') })
  await expect(picture).toHaveCount(1, { timeout: 15_000 })
  await editMode(page)
  await picture.click({ button: 'right' })
  await expect(page.locator('.hadley-textarea')).toHaveValue('<m data-size=50%>![A grey dot](dot.png)</m>')
})

// Michael, 2026-11-09: in a drawing the theme sized every svg to its width, the dots of the block's menu too
test('the menu trigger of a drawing keeps the size of its symbol', async ({ page, dev }) => {
  await writeFile(
    join(dirname(dev.source), 'square.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n',
  )
  await writeFile(
    dev.source,
    (await readFile(dev.source, 'utf8')) + '\n<m data-svg=inline>![A square](square.svg)</m>\n',
  )
  await page.goto(dev.origin + '/panel/')
  const drawing = page.locator('figure[data-svg][data-hadley-id]')
  await expect(drawing).toHaveCount(1, { timeout: 15_000 })
  await editMode(page)
  await drawing.hover()
  const dots = drawing.locator('.hadley-trigger svg')
  await expect(dots).toBeVisible()
  const box = await dots.boundingBox()
  expect(box?.width).toBe(15)
})
