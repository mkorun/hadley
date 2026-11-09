// The block menu: a trigger (⋯) on each block, shown by CSS :hover, in sync with the border and background; pointing
// at it, or ArrowDown on it, opens the slide-out menu (#hadley-block-menu): a new block below, merge with the block
// above or below, ↑ ↓, 🗑. A right click on a block edits it. Void elements (<hr>) get their trigger as a sibling,
// shown by JS.
import { clickedWord } from '../core/caret.ts'
import type { Clicked } from '../core/word.ts'
import { el } from '../core/dom.ts'
import { icon, type IconName } from '../core/icons.ts'
import { state, isEditMode } from '../core/state.ts'
import { T } from '../core/texts.ts'

export type Direction = 'up' | 'down'

export interface Menu {
  /** the triggers on the page's blocks, and their right click; again after the page changed in place, for new blocks */
  attach(): void
  close(): void
  isOpen(): boolean
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** The menu, in the body; what its items do, and a right click, is the caller's. */
export function menu(on: {
  add(block: HTMLElement): void
  merge(block: HTMLElement, direction: Direction): void
  move(block: HTMLElement, direction: Direction): void
  remove(block: HTMLElement): void
  edit(block: HTMLElement, word?: Clicked): void
}): Menu {
  let menuBlockEl: HTMLElement | null = null // block whose menu is open
  let menuTriggerEl: HTMLElement | null = null // trigger button of the open menu
  let menuLeaveTimer: ReturnType<typeof setTimeout> | null = null // debounce for closing the menu automatically
  const busy = () => !isEditMode() || state.locked || state.block !== null

  const blockMenu = el('div')
  blockMenu.id = 'hadley-block-menu'
  blockMenu.setAttribute('hidden', '')
  blockMenu.setAttribute('role', 'menu')

  const item = (cls: string, name: IconName, label: string) => {
    const b = el('button', cls)
    b.append(icon(name))
    b.setAttribute('aria-label', label)
    b.setAttribute('role', 'menuitem')
    return b
  }
  const addBtn = item('hadley-menu-add', 'add', T.addBelowLabel)
  const mergeTopBtn = item('hadley-menu-merge', 'merge_top', T.mergeUpLabel)
  const mergeBotBtn = item('hadley-menu-merge', 'merge_bot', T.mergeDownLabel)
  const upBtn = item('hadley-menu-move', 'up', T.moveUpLabel)
  const downBtn = item('hadley-menu-move', 'down', T.moveDownLabel)
  const deleteBtn = item('hadley-menu-delete', 'delete', T.deleteLabel)
  const addSep = el('div', 'hadley-menu-sep')
  const mergeSep = el('div', 'hadley-menu-sep')
  const moveSep = el('div', 'hadley-menu-sep')
  blockMenu.append(addBtn, addSep, mergeTopBtn, mergeBotBtn, mergeSep, upBtn, downBtn, moveSep, deleteBtn)
  document.body.appendChild(blockMenu)

  const contains = (node: EventTarget | null) => node instanceof Node && blockMenu.contains(node)

  function openMenu(blockEl: HTMLElement, triggerEl: HTMLElement) {
    if (state.locked || state.block) return
    if (menuTriggerEl === triggerEl) {
      cancelMenuClose()
      return
    } // already open → stop the timer

    closeMenu()
    menuBlockEl = blockEl
    menuTriggerEl = triggerEl

    const allBlocks = [...document.querySelectorAll('[data-hadley-id]')]
    const idx = allBlocks.indexOf(blockEl)
    const isParagraph = blockEl.tagName === 'P'
    const prevBlock = allBlocks[idx - 1]
    const nextBlock = allBlocks[idx + 1]
    const showMergeTop = isParagraph && !!prevBlock && prevBlock.tagName === 'P'
    const showMergeBot = isParagraph && !!nextBlock && nextBlock.tagName === 'P'
    const showMoveUp = idx !== 0
    const showMoveDown = idx !== allBlocks.length - 1
    mergeTopBtn.style.display = showMergeTop ? '' : 'none'
    mergeBotBtn.style.display = showMergeBot ? '' : 'none'
    mergeSep.style.display = showMergeTop || showMergeBot ? '' : 'none'
    upBtn.style.display = showMoveUp ? '' : 'none'
    downBtn.style.display = showMoveDown ? '' : 'none'
    moveSep.style.display = showMoveUp || showMoveDown ? '' : 'none'

    triggerEl.classList.add('is-active')
    blockEl.classList.add('hadley-block-active')
    blockMenu.removeAttribute('hidden')

    // Position: left of the trigger, centred vertically
    const tr = triggerEl.getBoundingClientRect()
    const mw = blockMenu.offsetWidth
    const mh = blockMenu.offsetHeight
    blockMenu.style.top = `${tr.top + window.scrollY + (tr.height - mh) / 2}px`
    blockMenu.style.left = `${tr.left + window.scrollX - mw}px`
  }

  function scheduleMenuClose() {
    if (menuBlockEl) menuBlockEl.classList.remove('hadley-block-active') // remove at once
    if (menuLeaveTimer) clearTimeout(menuLeaveTimer)
    menuLeaveTimer = setTimeout(() => {
      menuLeaveTimer = null
      closeMenu()
    }, 500)
  }

  function cancelMenuClose() {
    if (menuLeaveTimer) clearTimeout(menuLeaveTimer)
    menuLeaveTimer = null
    if (menuBlockEl) menuBlockEl.classList.add('hadley-block-active') // restore
  }

  function closeMenu() {
    cancelMenuClose()
    if (menuTriggerEl) menuTriggerEl.classList.remove('is-active')
    if (menuBlockEl) menuBlockEl.classList.remove('hadley-block-active')
    menuBlockEl = null
    menuTriggerEl = null
    blockMenu.setAttribute('hidden', '')
    // Void triggers (HR etc.) sit in document.body and do not move along with
    // transform — they must be hidden before the animation
    document.querySelectorAll('.hadley-trigger.is-visible').forEach((t) => t.classList.remove('is-visible'))
  }

  // Close the menu when focus leaves it (keyboard navigation)
  blockMenu.addEventListener('focusout', (e) => {
    if (!menuBlockEl) return
    if (contains(e.relatedTarget)) return // focus still in the menu
    if (e.relatedTarget === menuTriggerEl) return // focus back on the trigger
    scheduleMenuClose()
  })

  // Close the menu on a click outside it
  document.addEventListener('pointerdown', (e) => {
    if (!menuBlockEl) return
    if (contains(e.target) || blockMenu === e.target) return
    if ((e.target instanceof Node && menuTriggerEl?.contains(e.target)) || menuTriggerEl === e.target) return
    closeMenu()
  })

  // Close the menu when the pointer leaves it
  blockMenu.addEventListener('mouseenter', cancelMenuClose)
  blockMenu.addEventListener('mouseleave', (e) => {
    if (!menuBlockEl) return
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null
    if ((to && menuTriggerEl?.contains(to)) || e.relatedTarget === menuTriggerEl) return
    // Into the block content → close at once; outside → close after a delay
    if ((to && menuBlockEl.contains(to)) || e.relatedTarget === menuBlockEl) closeMenu()
    else scheduleMenuClose()
  })

  // Safety net: mouseleave can be skipped when the mouse moves fast
  document.addEventListener('pointermove', (e) => {
    if (!menuBlockEl || state.block || menuLeaveTimer) return
    if (blockMenu.hasAttribute('hidden')) return
    const br = menuBlockEl.getBoundingClientRect()
    const mr = blockMenu.getBoundingClientRect()
    const x = e.clientX,
      y = e.clientY
    const inBlock = x >= br.left && x <= br.right && y >= br.top && y <= br.bottom
    const inMenu = x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom
    if (!inBlock && !inMenu) scheduleMenuClose()
  })

  // Each action handles every failure itself (the request and everything before it), so the menu does not await it.
  mergeTopBtn.addEventListener('click', () => {
    if (menuBlockEl) on.merge(menuBlockEl, 'up')
  })
  mergeBotBtn.addEventListener('click', () => {
    if (menuBlockEl) on.merge(menuBlockEl, 'down')
  })
  upBtn.addEventListener('click', () => {
    if (menuBlockEl) on.move(menuBlockEl, 'up')
  })
  downBtn.addEventListener('click', () => {
    if (menuBlockEl) on.move(menuBlockEl, 'down')
  })
  deleteBtn.addEventListener('click', () => {
    if (menuBlockEl) on.remove(menuBlockEl)
  })
  addBtn.addEventListener('click', () => {
    if (menuBlockEl?.dataset['hadleyId']) on.add(menuBlockEl)
  })

  // a block has its trigger once; a void block's stands in the body, and goes with its block (../refresh/)
  const attached = new WeakSet<Element>()
  const floating = new Map<HTMLElement, Element>()

  function attach() {
    for (const [trigger, block] of floating) {
      if (block.isConnected) continue
      trigger.remove()
      floating.delete(trigger)
    }
    for (const block of document.querySelectorAll<HTMLElement>('[data-hadley-id]')) {
      if (attached.has(block)) continue
      attached.add(block)
      const isVoid = VOID_TAGS.has(block.tagName.toLowerCase())

      const trigger = el('button', 'hadley-trigger')
      trigger.append(icon('dots'))
      trigger.setAttribute('aria-label', T.blockActionsLabel)
      trigger.setAttribute('aria-haspopup', 'menu')
      const intoTrigger = (to: EventTarget | null) => to === trigger || (to instanceof Node && trigger.contains(to))
      const intoBlock = (to: EventTarget | null) => to === block || (to instanceof Node && block.contains(to))

      if (isVoid) {
        // Append the trigger to body directly — positioned with getBoundingClientRect, independent of margins
        document.body.appendChild(trigger)
        floating.set(trigger, block)

        const positionTrigger = () => {
          const r = block.getBoundingClientRect()
          const size = 26
          Object.assign(trigger.style, {
            position: 'absolute',
            zIndex: '9998',
            top: `${r.top + window.scrollY + (r.height - size) / 2}px`,
            left: `${r.right + window.scrollX - size - 2}px`,
            right: 'auto',
          })
        }

        let leaveTimer: ReturnType<typeof setTimeout> | undefined
        const showTrigger = () => {
          if (busy()) return
          clearTimeout(leaveTimer)
          positionTrigger()
          trigger.classList.add('is-visible')
        }
        const hideTrigger = () => {
          leaveTimer = setTimeout(() => trigger.classList.remove('is-visible'), 120)
        }
        block.addEventListener('mouseenter', showTrigger)
        block.addEventListener('mouseleave', (e) => {
          if (intoTrigger(e.relatedTarget)) return
          hideTrigger()
        })
        trigger.addEventListener('mouseenter', () => {
          clearTimeout(leaveTimer)
          cancelMenuClose() // stop a running close timer
          if (busy()) return
          openMenu(block, trigger)
        })
        trigger.addEventListener('mouseleave', (e) => {
          if (intoBlock(e.relatedTarget)) return
          if (contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
          hideTrigger()
          trigger.classList.remove('is-active')
          closeMenu()
        })
      } else {
        // <details> blocks (for example .exkurs) hide every child except <summary> while closed, through a
        // shadow-tree slot — a trigger as a sibling of <summary> would stay invisible. So it goes on <summary>
        // itself, which is always rendered.
        const summary = block.tagName === 'DETAILS' ? block.querySelector(':scope > summary') : null
        if (summary) {
          summary.appendChild(trigger)
          // A click on a control inside <summary> would otherwise also trigger the native
          // open/close.
          trigger.addEventListener('click', (e) => e.preventDefault())
        } else {
          block.appendChild(trigger)
        }
      }

      trigger.addEventListener('click', () => {
        if (busy()) return
        openMenu(block, trigger)
      })
      trigger.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown') return
        if (busy()) return
        e.preventDefault()
        openMenu(block, trigger)
        blockMenu.querySelector<HTMLElement>('button:not([style*="none"])')?.focus()
      })

      trigger.addEventListener('mouseenter', () => {
        cancelMenuClose() // stop a running close timer (for example after leaving the menu)
        if (busy()) return
        openMenu(block, trigger)
      })

      // Pointer leaves the trigger → close at once, unless it moves into the menu
      trigger.addEventListener('mouseleave', (e) => {
        if (contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
        closeMenu()
      })

      // Close the menu when the trigger loses focus (keyboard navigation)
      trigger.addEventListener('blur', (e) => {
        if (contains(e.relatedTarget)) return // focus moves into the menu
        scheduleMenuClose()
      })

      // Close the menu when the pointer leaves the block without entering the menu
      block.addEventListener('mouseenter', (e) => {
        if (menuBlockEl !== block) return
        // Do not cancel when the pointer comes from the menu — that is an intended leave
        if (contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
        cancelMenuClose()
      })
      block.addEventListener('mouseleave', (e) => {
        if (menuBlockEl !== block) return
        if (contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
        scheduleMenuClose()
      })

      // A double click opens it too, the cursor on the word clicked (Michael, 2026-11-09); in edit mode only, so that
      // reading still selects words
      block.addEventListener('dblclick', (e) => {
        if (!isEditMode() || state.block || state.locked) return
        if (e.target instanceof Element && e.target.closest('.hadley-trigger')) return
        e.preventDefault()
        if (block.dataset['hadleyId']) on.edit(block, clickedWord(block))
      })

      // Right click opens the editor (bound directly, bypasses stopPropagation in theme JS)
      block.addEventListener('contextmenu', (e) => {
        if (!isEditMode() || state.block || state.locked) return
        e.preventDefault()
        e.stopPropagation()
        if (block.dataset['hadleyId']) on.edit(block)
      })
    }
  }

  return { attach, close: closeMenu, isOpen: () => menuBlockEl !== null }
}
