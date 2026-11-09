// Frames: what can be edited, visible on any ground.
//
// A frame is two tones, a dark line and a light one, so one of them stands out from a light page, a dark one, a dark
// area of a light page or a picture. It cannot be the block's own outline (one tone) or box-shadow (it fills the gap
// to the block), nor a child of the block (a code block's overflow would clip it). So the frames have a layer of their
// own over the page, z-index 1: under a site's fixed or sticky bars, above the text. They follow the blocks through
// resizes, changes to the page and the move animations.
import { el } from '../core/dom.ts'
import { isEditMode, state } from '../core/state.ts'

const FRAMED = '[data-hadley-id], [data-hadley-head-editable]'

export interface Frames {
  /** the frames placed anew, at the next frame of the browser */
  queue(): void
  /** the layer in the body, following the page from now on */
  start(): void
  /** the front matter's badge (heads.ts), placed with the frames */
  badge(badge: HTMLElement): void
}

export function frames(): Frames {
  const layer = el('div')
  layer.id = 'hadley-frames'
  layer.setAttribute('aria-hidden', 'true')
  const shown = new Map<Element, HTMLElement>()
  let queued = false
  let frontMatterBadge: HTMLElement | null = null
  let movingUntil = 0

  const place = () => {
    queued = false
    if (!isEditMode()) {
      layer.hidden = true
      return
    }
    layer.hidden = false
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--he-frame-gap')) || 10
    const seen = new Set<Element>()
    const placed: { block: Element; frame: HTMLElement; r: DOMRect; above: number; below: number; shares: boolean }[] =
      []
    for (const block of document.querySelectorAll(FRAMED)) {
      seen.add(block)
      let frame = shown.get(block)
      if (!frame) {
        frame = el('div', 'hadley-frame')
        layer.append(frame)
        shown.set(block, frame)
        observer.observe(block)
      }
      const r = block.getBoundingClientRect()
      frame.hidden = r.width === 0 && r.height === 0
      if (!frame.hidden) placed.push({ block, frame, r, above: gap, below: gap, shares: false })
    }
    // off the block on every side by --he-frame-gap, as far as the tint of a hovered block reaches (frames.css); but
    // two blocks closer than about two gaps meet in the middle of the space between them, and the lower one draws no
    // line there: one line between them, not two that nearly touch (Michael, 2026-11-09: the lines looked uneven)
    for (const upper of placed) {
      let next: (typeof placed)[number] | undefined
      for (const other of placed) {
        const across = other.r.left < upper.r.right && upper.r.left < other.r.right
        if (other === upper || !across || other.r.top < upper.r.bottom - 1) continue
        if (!next || other.r.top < next.r.top) next = other
      }
      if (!next) continue
      const space = next.r.top - upper.r.bottom
      // up to a little more than two gaps too: two lines a few pixels apart look as uneven as two that touch
      if (space < 0 || space >= 2 * gap + 8) continue
      upper.below = space / 2
      next.above = space / 2
      next.shares = true
    }
    for (const { block, frame, r, above, below, shares } of placed) {
      Object.assign(frame.style, {
        top: `${r.top + window.scrollY - above}px`,
        left: `${r.left + window.scrollX - gap}px`,
        width: `${r.width + 2 * gap}px`,
        height: `${r.height + above + below}px`,
      })
      frame.classList.toggle('shares-top', shares)
      frame.classList.toggle('is-hover', block.matches(':hover'))
      frame.classList.toggle('is-active', block.classList.contains('hadley-block-active'))
    }
    for (const [block, frame] of shown) {
      if (seen.has(block)) continue
      frame.remove()
      shown.delete(block)
      observer.unobserve(block)
    }
    // the front matter's badge sits right above the title's frame, flush with its right edge, so that it takes no room
    // on the page and keeps clear of what a theme puts left above a title
    if (frontMatterBadge && frontMatterBadge.isConnected) {
      const title = document.querySelector('[data-hadley-head="title"]')
      const frame = title && shown.get(title)
      frontMatterBadge.hidden = !frame || frame.hidden
      if (title && frame && !frame.hidden) {
        const right = parseFloat(frame.style.left) + parseFloat(frame.style.width)
        // over a narrow title, the symbol alone (keys and values), so that it keeps clear of what stands left above it
        frontMatterBadge.classList.toggle('is-compact', parseFloat(frame.style.width) < 480)
        // in the middle of the line right above the title, where a theme has one (a date, a category), else just
        // above the frame; while the front matter's field is open above the title, above that field, so that the badge
        // stays where it was (Michael, 2026-11-09: it slid down below the field)
        const field = state.wrapper && title.previousElementSibling === state.wrapper ? state.wrapper : undefined
        frontMatterBadge.classList.toggle('is-open', field !== undefined)
        frontMatterBadge.setAttribute('aria-expanded', String(field !== undefined))
        const anchor = field ?? title
        const above = anchor.previousElementSibling?.getBoundingClientRect()
        const anchorTop = anchor.getBoundingClientRect().top
        const height = frontMatterBadge.offsetHeight
        const inLine = above && above.height > 0 && above.height < 80 && anchorTop - above.bottom >= 0
        frontMatterBadge.style.top =
          inLine && anchorTop - above.bottom < 48
            ? `${above.top + window.scrollY + (above.height - height) / 2}px`
            : field
              ? `${anchorTop + window.scrollY - height - 4}px`
              : `${parseFloat(frame.style.top) - height - 4}px`
        frontMatterBadge.style.left = `${right - frontMatterBadge.offsetWidth}px`
      }
    }
    // while a block moves (the move animations), every frame, for a second at most
    if (performance.now() < movingUntil) queue()
  }

  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(place)
  }

  const observer = new ResizeObserver(queue)

  const start = () => {
    document.body.append(layer)
    observer.observe(document.documentElement)
    new MutationObserver((records) => {
      if (records.some((record) => record.target !== layer && !layer.contains(record.target))) queue()
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    document.addEventListener('pointerover', queue, { passive: true })
    document.addEventListener('pointerout', queue, { passive: true })
    // a frame in a fixed or sticky area moves with the scroll
    window.addEventListener('scroll', queue, { passive: true })
    document.addEventListener('transitionrun', (e) => {
      if (e.propertyName !== 'transform' || !(e.target instanceof Element) || !e.target.matches(FRAMED)) return
      movingUntil = performance.now() + 1000
      queue()
    })
    document.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'transform' && e.target instanceof Element && e.target.matches(FRAMED)) queue()
    })
    void document.fonts?.ready.then(queue)
    queue()
  }

  return {
    queue,
    start,
    badge(badge) {
      frontMatterBadge = badge
    },
  }
}
