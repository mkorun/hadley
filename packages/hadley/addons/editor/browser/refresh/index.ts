// After a rebuild that changed only the Markdown of pages, the dev server says `hadley:built` instead of reloading the
// pages (lib/dev-server.ts): each open page fetches itself and brings itself up to date in place (swap.ts), so that
// its scroll position, open cards and focus stay. A page apart from the editor's other modules, which the dev server
// loads before them: if the editor fails, a rebuild still reloads the page. Any error reloads it too.
//
// What it says to the editor and to themes, as document events:
// - `hadley:refresh` (cancelable) before it changes the page; the editor holds it while a field is open, and lets it
//   go with `hadley:refresh-release`
// - `hadley:swapping` right before it changes the page, in the same task: what an animation left on the blocks goes
// - `hadley:refreshed` once it is done, whether the page changed or not
// - `hadley:content-updated` with `detail.added`, the new elements, when it changed (docs/themes.md)
// - `hadley:build-failed` when the rebuild failed
import { swap } from './swap.ts'

interface HotContext {
  on(event: string, callback: () => void): void
}

const page = (): string => location.pathname + location.search
const fetchPage = async (): Promise<string> => {
  const res = await fetch(page(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// the page as the server sent it: what the live page came from
let base: Promise<string> = fetchPage()
// a load cut off by a reload is no error of the page; a refresh that awaits it still meets the failure
base.catch(() => {})
let held = false
let running: Promise<void> | undefined

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')

/** The first block of the content in view, to keep it where it is. */
function anchor(): { element: Element; top: number } | undefined {
  for (const element of document.querySelectorAll('[data-hadley-id]')) {
    const { top, bottom } = element.getBoundingClientRect()
    if (bottom > 0) return { element, top }
  }
  return undefined
}

async function refresh(): Promise<void> {
  const proceed = document.dispatchEvent(new CustomEvent('hadley:refresh', { cancelable: true }))
  if (!proceed) {
    held = true
    return
  }
  held = false
  const [before, html] = await Promise.all([base, fetchPage()])
  if (html === before) return void document.dispatchEvent(new CustomEvent('hadley:refreshed'))
  // a field opened while the page was fetched holds it too (review 2026-11-09: its block was swapped under it)
  if (!document.dispatchEvent(new CustomEvent('hadley:refresh', { cancelable: true }))) {
    held = true
    return
  }
  const kept = anchor()
  const [then, now] = [parse(before), parse(html)]
  document.dispatchEvent(new CustomEvent('hadley:swapping'))
  const result = swap(document, then, now)
  if (result.kind === 'reload') {
    console.info(`hadley: reloading, ${result.why}`)
    return location.reload()
  }
  base = Promise.resolve(html)
  if (kept?.element.isConnected) window.scrollBy(0, kept.element.getBoundingClientRect().top - kept.top)
  // a calm fade, colour and opacity only: under reduced motion too
  for (const element of result.added) element.animate?.([{ opacity: 0 }, { opacity: 1 }], 150)
  if (result.changed)
    document.dispatchEvent(new CustomEvent('hadley:content-updated', { detail: { added: result.added } }))
  document.dispatchEvent(new CustomEvent('hadley:refreshed'))
}

/** One refresh at a time; one asked for meanwhile runs after it. */
function queue(): void {
  const next = (running ?? Promise.resolve()).then(() =>
    refresh().catch((error: unknown) => {
      console.info('hadley: reloading after an error', error)
      location.reload()
    }),
  )
  running = next
}

document.addEventListener('hadley:refresh-release', () => {
  if (held) queue()
})

// Vite's client, which the dev server puts in each page: a variable, so that the type checker does not look for it
const client = '/@vite/client'
try {
  const { createHotContext } = (await import(/* @vite-ignore */ client)) as {
    createHotContext(owner: string): HotContext
  }
  const hot = createHotContext('/__hadley/editor/refresh/index.ts')
  hot.on('hadley:built', queue)
  hot.on('hadley:build-failed', () => document.dispatchEvent(new CustomEvent('hadley:build-failed')))
} catch (error) {
  console.info('hadley: no soft refresh', error)
}
