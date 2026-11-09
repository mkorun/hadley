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
