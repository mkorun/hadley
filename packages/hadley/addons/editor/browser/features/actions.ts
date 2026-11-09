// What the block menu changes: merge, move and delete a block. Each animates first, then asks the server
// (plugin.ts), which writes the page's file; the page is brought up to date with it (../refresh/), and until then
// nothing else changes (ADR-14). The animation's styles stay on the blocks until then, and go as the page changes:
// a reload took them once, the blocks that stay now keep their elements (Michael, 2026-11-09); they go too when the
// server refuses. A deletion asks nothing: undo takes it back (undo.ts).
// Each action handles every failure itself, the request and everything before it.
import { answer, post, serverError } from '../core/request.ts'
import { state, clearHash, failAction } from '../core/state.ts'
import type { Change } from '../core/changes.ts'
import { T } from '../core/texts.ts'
import type { Direction } from './menu.ts'

export interface Actions {
  merge(block: HTMLElement, direction: Direction): Promise<void>
  move(block: HTMLElement, direction: Direction): Promise<void>
  remove(block: HTMLElement): Promise<void>
  /** the animations' styles taken off the blocks, as the page changes in place */
  settle(): void
}

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const blocks = () => [...document.querySelectorAll<HTMLElement>('[data-hadley-id]')]

// the blocks an animation styled, until the page changes
const styled = new Set<HTMLElement>()
const style = (element: HTMLElement, properties: Partial<Record<'transition' | 'transform' | 'opacity', string>>) => {
  styled.add(element)
  Object.assign(element.style, properties)
}

async function animateBlockSwap(blockEl: HTMLElement, direction: Direction) {
  const allBlocks = blocks()
  const idx = allBlocks.indexOf(blockEl)
  const neighborEl = allBlocks[direction === 'up' ? idx - 1 : idx + 1]
  if (!neighborEl) return

  // Third block: not swapped, but its CSS context changes (for example h2+p → p+p)
  // up:   the block below the heading (was h2+x, becomes neighbor+x)
  // down: the block below the swap partner (was partner+x, becomes h2+x)
  const thirdEl = direction === 'up' ? allBlocks[idx + 1] : allBlocks[idx + 2]

  const r1 = blockEl.getBoundingClientRect()
  const r2 = neighborEl.getBoundingClientRect()

  const isBlockLo = r1.top <= r2.top
  const lo = isBlockLo ? blockEl : neighborEl
  const hi = isBlockLo ? neighborEl : blockEl
  const loRect = isBlockLo ? r1 : r2
  const hiRect = isBlockLo ? r2 : r1

  const thirdRect = thirdEl?.getBoundingClientRect()

  // Swap the DOM briefly and measure the target positions — more exact than computing margins,
  // because margin collapse and adjacent-sibling selectors are taken into account automatically.
  // All synchronous → no paint between swapping and swapping back.
  const a = document.createComment('')
  lo.before(a)
  hi.after(lo)
  a.before(hi)
  a.remove()

  const loTarget = lo.getBoundingClientRect().top
  const hiTarget = hi.getBoundingClientRect().top
  const thirdTarget = thirdEl?.getBoundingClientRect().top

  const b = document.createComment('')
  hi.before(b)
  lo.after(hi)
  b.before(lo)
  b.remove()

  const DURATION = 300

  lo.getBoundingClientRect() // reflow: the transition starts from the initial position
  style(lo, { transition: `transform ${DURATION}ms ${EASE}` })
  style(hi, { transition: `transform ${DURATION}ms ${EASE}` })
  style(lo, { transform: `translateY(${loTarget - loRect.top}px)` })
  style(hi, { transform: `translateY(${hiTarget - hiRect.top}px)` })

  if (thirdEl && thirdRect && thirdTarget !== undefined) {
    const delta = thirdTarget - thirdRect.top
    if (Math.abs(delta) > 0.5) {
      style(thirdEl, { transition: `transform ${DURATION}ms ${EASE}` })
      style(thirdEl, { transform: `translateY(${delta}px)` })
    }
  }

  await wait(DURATION)
}

// outline-offset from the CSS: 8px — so that the dashed line of the moving block
// meets the dashed line of its neighbour exactly (and does not pass it).
const OUTLINE_OFFSET = 8

async function animateBlockMerge(blockEl: HTMLElement, direction: Direction) {
  const allBlocks = blocks()
  const idx = allBlocks.indexOf(blockEl)
  const neighborEl = allBlocks[direction === 'up' ? idx - 1 : idx + 1]
  if (!neighborEl) return

  const blockRect = blockEl.getBoundingClientRect()
  const neighborRect = neighborEl.getBoundingClientRect()

  const translateY =
    direction === 'up'
      ? neighborRect.bottom - blockRect.top + 2 * OUTLINE_OFFSET // negative → upwards
      : neighborRect.top - blockRect.bottom - 2 * OUTLINE_OFFSET // positive → downwards

  const DURATION = 220
  style(blockEl, { transition: `transform ${DURATION}ms ${EASE}` })
  blockEl.getBoundingClientRect() // reflow
  style(blockEl, { transform: `translateY(${translateY}px)` })

  await wait(DURATION)
}

async function animateBlockDelete(blockEl: HTMLElement) {
  const allBlocks = blocks()
  const idx = allBlocks.indexOf(blockEl)
  const blocksAfter = allBlocks.slice(idx + 1)
  const nextBlock = blocksAfter[0]

  const rect = blockEl.getBoundingClientRect()

  // Geometric: nextBlock moves up to the position of the deleted block.
  // Correct for every layout mechanism (margin collapse, flexbox, grid).
  const gapToFill = nextBlock ? nextBlock.getBoundingClientRect().top - rect.top : rect.height

  const DURATION = 270

  // Deleted block: slide out to the left and fade out
  style(blockEl, { transition: `opacity ${DURATION}ms ease, transform ${DURATION}ms ease` })
  blockEl.getBoundingClientRect() // reflow
  style(blockEl, { opacity: '0', transform: 'translateX(-18px)' })

  // Following blocks: close the gap
  blocksAfter.forEach((other) => {
    style(other, { transition: `transform ${DURATION}ms ${EASE}` })
    style(other, { transform: `translateY(-${gapToFill}px)` })
  })

  await wait(DURATION)
}

/** The animations' styles off the blocks, at once, with no transition back. */
function settle(): void {
  for (const element of styled) {
    for (const name of ['transition', 'transform', 'opacity']) element.style.removeProperty(name)
    if (element.style.length === 0) element.removeAttribute('style')
  }
  styled.clear()
}

/** The actions; `closeMenu` before each, `lock` once the server took it, with what it was. */
export function actions(on: { closeMenu(): void; lock(what: NonNullable<Change['what']>): void }): Actions {
  /** Animate, then send. */
  const change = async (
    what: 'move' | 'merge' | 'delete',
    blockEl: HTMLElement,
    path: string,
    body: (blockId: string) => unknown,
    animate: () => Promise<void>,
    failed: (status: number, msg: string) => string,
  ) => {
    if (state.locked) return
    const blockId = blockEl.dataset['hadleyId']
    if (!blockId) return

    try {
      on.closeMenu()
      await animate()
    } catch (error) {
      // The page may show a half-animated state; reloading shows the file as it is.
      failAction(error)
      location.reload()
      return
    }

    try {
      const res = await post(path, body(blockId))

      if (res.ok) {
        on.lock(what)
        return
      }

      const data = await answer(res)
      if (res.status === 409) {
        alert(T.fileChangedReload)
        location.reload()
        return
      }
      settle()
      alert(failed(res.status, serverError(data)))
    } catch {
      settle()
      alert(T.connectionFailed)
    }
  }

  return {
    settle,
    merge: (blockEl, direction) =>
      change(
        'merge',
        blockEl,
        '/__hadley/merge',
        (blockId) => ({ blockId, direction }),
        async () => {
          clearHash()
          await animateBlockMerge(blockEl, direction)
        },
        T.mergeError,
      ),
    move: (blockEl, direction) =>
      change(
        'move',
        blockEl,
        '/__hadley/move',
        (blockId) => ({ blockId, direction }),
        async () => {
          clearHash()
          await animateBlockSwap(blockEl, direction)
        },
        T.moveError,
      ),
    remove: (blockEl) =>
      change(
        'delete',
        blockEl,
        '/__hadley/delete',
        (blockId) => ({ blockId }),
        async () => {
          clearHash()
          await animateBlockDelete(blockEl)
        },
        T.deleteError,
      ),
  }
}
