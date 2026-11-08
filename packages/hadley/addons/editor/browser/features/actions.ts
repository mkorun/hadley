// What the block menu changes: merge, move and delete a block. Each animates first, then asks the server
// (plugin.ts), which writes the page's file; the page reloads with it, and until then nothing else changes (ADR-14).
// Each action handles every failure itself, the request and everything before it.
import { answer, post, serverError } from '../core/request.ts'
import { state, clearHash, failAction } from '../core/state.ts'
import { T } from '../core/texts.ts'
import type { Direction } from './menu.ts'

export interface Actions {
  merge(block: HTMLElement, direction: Direction): Promise<void>
  move(block: HTMLElement, direction: Direction): Promise<void>
  remove(block: HTMLElement): Promise<void>
}

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const blocks = () => [...document.querySelectorAll<HTMLElement>('[data-hadley-id]')]

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
  lo.style.transition = `transform ${DURATION}ms ${EASE}`
  hi.style.transition = `transform ${DURATION}ms ${EASE}`
  lo.style.transform = `translateY(${loTarget - loRect.top}px)`
  hi.style.transform = `translateY(${hiTarget - hiRect.top}px)`

  if (thirdEl && thirdRect && thirdTarget !== undefined) {
    const delta = thirdTarget - thirdRect.top
    if (Math.abs(delta) > 0.5) {
      thirdEl.style.transition = `transform ${DURATION}ms ${EASE}`
      thirdEl.style.transform = `translateY(${delta}px)`
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
  blockEl.style.transition = `transform ${DURATION}ms ${EASE}`
  blockEl.getBoundingClientRect() // reflow
  blockEl.style.transform = `translateY(${translateY}px)`

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
  blockEl.style.transition = `opacity ${DURATION}ms ease, transform ${DURATION}ms ease`
  blockEl.getBoundingClientRect() // reflow
  blockEl.style.opacity = '0'
  blockEl.style.transform = 'translateX(-18px)'

  // Following blocks: close the gap
  blocksAfter.forEach((other) => {
    other.style.transition = `transform ${DURATION}ms ${EASE}`
    other.style.transform = `translateY(-${gapToFill}px)`
  })

  await wait(DURATION)
}

/** The actions; `closeMenu` before each, `lock` once the server took it, `confirm` before a delete. */
export function actions(on: { closeMenu(): void; lock(): void; confirm(): Promise<boolean> }): Actions {
  /** Animate, then send; `animate` answering false cancels the action. */
  const change = async (
    blockEl: HTMLElement,
    path: string,
    body: (blockId: string) => unknown,
    animate: () => Promise<boolean>,
    failed: (status: number, msg: string) => string,
  ) => {
    if (state.locked) return
    const blockId = blockEl.dataset['hadleyId']
    if (!blockId) return

    try {
      on.closeMenu()
      if (!(await animate())) return
    } catch (error) {
      // The page may show a half-animated state; reloading shows the file as it is.
      failAction(error)
      location.reload()
      return
    }

    try {
      const res = await post(path, body(blockId))

      if (res.ok) {
        on.lock()
        return
      }

      const data = await answer(res)
      if (res.status === 409) {
        alert(T.fileChangedReload)
        location.reload()
        return
      }
      alert(failed(res.status, serverError(data)))
    } catch {
      alert(T.connectionFailed)
    }
  }

  return {
    merge: (blockEl, direction) =>
      change(
        blockEl,
        '/__hadley/merge',
        (blockId) => ({ blockId, direction }),
        async () => {
          clearHash()
          await animateBlockMerge(blockEl, direction)
          return true
        },
        T.mergeError,
      ),
    move: (blockEl, direction) =>
      change(
        blockEl,
        '/__hadley/move',
        (blockId) => ({ blockId, direction }),
        async () => {
          clearHash()
          await animateBlockSwap(blockEl, direction)
          return true
        },
        T.moveError,
      ),
    remove: (blockEl) =>
      change(
        blockEl,
        '/__hadley/delete',
        (blockId) => ({ blockId }),
        async () => {
          if (!(await on.confirm())) return false
          clearHash()
          await animateBlockDelete(blockEl)
          return true
        },
        T.deleteError,
      ),
  }
}
