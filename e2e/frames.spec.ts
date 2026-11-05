// The editor's frames (addons/editor/assets/editor.js, "Frames") stand out from any ground: a light page, a dark one, a
// dark area of a light page and a gradient. Measured on the pixels, as WCAG measures a control's edge: at least 3:1.
import { test, expect } from './chat-fixture.ts'
import type { Locator, Page } from '@playwright/test'

const grounds = {
  white: '#ffffff',
  black: '#000000',
  petrol: '#0e4a55',
  gradient: 'linear-gradient(90deg, #ffffff, #0e4a55 50%, #000000)',
}

/** The highest contrast ratio between the ground and any pixel of a strip across the middle of a frame's top edge. */
async function edgeContrast(page: Page, frame: Locator): Promise<number> {
  const box = await frame.boundingBox()
  if (!box) throw new Error('no frame')
  const clip = { x: box.x + box.width / 2 - 12, y: box.y - 6, width: 24, height: 12 }
  // the browser decodes the screenshot; tsconfig has no DOM types, hence the shapes
  type Pixels = { data: ArrayLike<number> }
  type Canvas = {
    width: number
    height: number
    getContext(kind: '2d'): {
      drawImage(image: unknown, x: number, y: number): void
      getImageData(...box: number[]): Pixels
    }
  }
  type Browser = {
    Image: new () => { src: string; width: number; height: number; decode(): Promise<void> }
    document: { createElement(tag: 'canvas'): Canvas }
  }
  const png = (await page.screenshot({ clip })).toString('base64')
  const info = { width: Math.round(clip.width), height: Math.round(clip.height) }
  const data = await page.evaluate(async (source) => {
    const { Image, document } = globalThis as unknown as Browser
    const image = new Image()
    image.src = `data:image/png;base64,${source}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    // RGB of each pixel, at one pixel per CSS pixel
    const rgba = context.getImageData(0, 0, image.width, image.height).data
    const rgb: number[] = []
    for (let i = 0; i < rgba.length; i += 4) rgb.push(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
    return { rgb, width: image.width, height: image.height }
  }, png)
  info.width = data.width
  info.height = data.height
  const luminance = (i: number) => {
    const channel = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(data.rgb[i]!) + 0.7152 * channel(data.rgb[i + 1]!) + 0.0722 * channel(data.rgb[i + 2]!)
  }
  // the first row is the ground, 6 px off the frame
  let best = 1
  for (let x = 0; x < info.width; x++) {
    const ground = luminance(x * 3)
    for (let y = 0; y < info.height; y++) {
      const l = luminance((y * info.width + x) * 3)
      best = Math.max(best, (Math.max(l, ground) + 0.05) / (Math.min(l, ground) + 0.05))
    }
  }
  return best
}

for (const [name, ground] of Object.entries(grounds)) {
  test(`frames stand out from a ${name} ground, at rest and under the pointer`, async ({ page, dev }) => {
    await page.goto(dev.origin + '/panel/')
    await page.addStyleTag({ content: `html, body { background: ${ground} !important; }` })
    await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
    const block = page.locator('[data-hadley-id]').first()
    await expect(page.locator('.hadley-frame').first()).toBeVisible()
    await page.mouse.move(0, 0)
    // the frame's transitions take 0.2 s
    await page.waitForTimeout(300)
    expect(await edgeContrast(page, page.locator('.hadley-frame').last())).toBeGreaterThanOrEqual(3)
    await block.hover()
    await expect(page.locator('.hadley-frame.is-hover')).toHaveCount(1)
    await page.waitForTimeout(300)
    expect(await edgeContrast(page, page.locator('.hadley-frame.is-hover'))).toBeGreaterThanOrEqual(3)
  })
}

test('a frame follows its block when the page above it grows, and leaves with edit mode', async ({ page, dev }) => {
  await page.goto(dev.origin + '/panel/')
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  const block = page.locator('[data-hadley-id]').last()
  const frameOf = async () => {
    const [blockBox, frames] = await Promise.all([
      block.boundingBox(),
      page.locator('.hadley-frame').evaluateAll((all) => all.map((f) => f.getBoundingClientRect().toJSON())),
    ])
    return { blockBox, frames }
  }
  const before = await frameOf()
  // the page above the block grows, as when an image loads
  await page.addStyleTag({ content: 'main::before { content: ""; display: block; height: 120px; }' })
  await expect
    .poll(async () => {
      const { blockBox, frames } = await frameOf()
      return frames.some((f) => Math.abs(f.top + 8 - (blockBox?.y ?? 0)) < 1)
    })
    .toBe(true)
  expect((await frameOf()).blockBox?.y).toBeGreaterThan((before.blockBox?.y ?? 0) + 100)
  await page.getByRole('button', { name: 'Toggle edit mode', exact: true }).click()
  await expect(page.locator('#hadley-frames')).toBeHidden()
})

test('with reduced motion nothing that opens moves; without it, it rises into place', async ({ page, dev }) => {
  // a theme may stop every animation under reduced motion, as hems does: then none is as good as a fade
  for (const [motion, names] of [
    ['reduce', ['hadley-fade', 'none']],
    ['no-preference', ['hadley-rise']],
  ] as const) {
    await page.emulateMedia({ reducedMotion: motion })
    await page.goto(dev.origin + '/panel/')
    // the panel stays open across a reload in this tab: it opens anew each time
    const toggle = page.getByRole('button', { name: 'Chat', exact: true })
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
    await expect(page.locator('#hadley-chat')).toBeHidden()
    await toggle.click()
    const panel = page.locator('#hadley-chat')
    await expect(panel).toBeVisible()
    const name = await panel.evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).animationName)
    expect(names as readonly string[]).toContain(name)
  }
})
