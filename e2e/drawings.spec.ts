// Drawings (docs/content.md, "Drawings"; hems' style.css) in each browser: written into the page, the narrow version
// where the text is narrow, a click enlarges the wide one, and the browser loads no drawing file.
import { expect, test } from '@playwright/test'

const page = '/drawn/'

test('the drawing is part of the page, and its file is never loaded', async ({ page: tab }) => {
  const loaded: string[] = []
  tab.on('request', (request) => loaded.push(new URL(request.url()).pathname))
  await tab.goto(page)
  const figure = tab.locator('figure[data-svg]')
  await expect(figure.locator('[data-svg-wide] svg')).toBeVisible()
  await expect(figure.locator('svg[data-svg-narrow]')).toBeHidden()
  await expect(figure.locator('[data-svg-wide] svg title')).toHaveText('Wide chart')
  // the accent of the theme reaches the mark through its class
  const fill = await figure.locator('[data-svg-wide] rect.fig-accent').evaluate((rect) => getComputedStyle(rect).fill)
  expect(fill).not.toBe('rgb(0, 0, 0)')
  await figure.locator('[data-svg-wide] > button').click()
  // chart.svg and chart.narrow.svg are published beside the page, for its Markdown twin; the page itself needs neither
  expect(loaded.filter((path) => path.startsWith(page) && path.endsWith('.svg'))).toEqual([])
})

test('a narrow text shows the narrow drawing', async ({ page: tab }) => {
  await tab.setViewportSize({ width: 390, height: 844 })
  await tab.goto(page)
  const figure = tab.locator('figure[data-svg]')
  await expect(figure.locator('svg[data-svg-narrow]')).toBeVisible()
  await expect(figure.locator('[data-svg-wide]')).toBeHidden()
})

test('a click enlarges the wide drawing in a popover, and Escape closes it', async ({ page: tab }) => {
  await tab.goto(page)
  const wide = tab.locator('figure[data-svg] [data-svg-wide]')
  const open = () => wide.evaluate((popover) => popover.matches(':popover-open'))
  expect(await open()).toBe(false)
  await wide.locator('> button').click()
  expect(await open()).toBe(true)
  // enlarged, it is wider than in the text
  const width = await wide.locator('svg').evaluate((svg) => svg.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(600)
  await tab.keyboard.press('Escape')
  expect(await open()).toBe(false)
})
