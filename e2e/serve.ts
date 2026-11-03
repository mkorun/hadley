/**
 * The site the browser tests (e2e/*.spec.ts) open: hems with its blank starter and one article with a drawing, built
 * for publishing into a temporary directory and served on 127.0.0.1. Playwright starts it (playwright.config.ts) and
 * waits for the home page.
 *
 *   bun e2e/serve.ts [port]
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { build } from '../packages/hadley/index.ts'
import { init } from '../packages/hadley/lib/init.ts'

const port = Number(process.argv[2] ?? 4173)

/** A drawing hadley accepts: a wide one and its narrow version, each with a mark in the theme's accent. */
const drawing = (width: number, label: string) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 120" width="${width}" height="120"`,
    '  role="img" aria-labelledby="t">',
    `  <title id="t">${label}</title>`,
    `  <rect class="fig-accent" x="20" y="40" width="${width / 2}" height="24"/>`,
    `  <text x="20" y="20" font-size="14">${label}</text>`,
    '</svg>',
    '',
  ].join('\n')

const dir = await mkdtemp(join(tmpdir(), 'hadley-e2e-'))
const site = join(dir, 'site')
await init(site, ['en'], 'hems', 'blank')
const bundle = join(site, 'content', 'articles', '[drawn]')
await mkdir(bundle, { recursive: true })
await writeFile(join(bundle, 'chart.svg'), drawing(880, 'Wide chart'))
await writeFile(join(bundle, 'chart.narrow.svg'), drawing(400, 'Narrow chart'))
const article = ['Before the drawing.', '<m data-svg=inline>![A chart](chart.svg)</m>', 'After it.'].join('\n\n')
await writeFile(join(bundle, 'drawn.md'), `---\ntitle: Drawn\npublishFrom: 2026-01-01\n---\n${article}\n`)
await build(site, 'publish')

const root = join(site, '.hadley', 'publish')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const path = normalize(join(root, decodeURIComponent(new URL(request.url).pathname)))
    if (path !== root && !path.startsWith(root + sep)) return new Response('outside the site', { status: 403 })
    const file = Bun.file(path.endsWith(sep) ? join(path, 'index.html') : path)
    if (await file.exists()) return new Response(file)
    const index = Bun.file(join(path, 'index.html'))
    return (await index.exists()) ? new Response(index) : new Response('not found', { status: 404 })
  },
})
console.log(`e2e site at ${server.url}`)

const stop = async () => {
  await server.stop(true)
  await rm(dir, { recursive: true, force: true })
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop())
