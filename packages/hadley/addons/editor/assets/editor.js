/**
 * hadley Block Editor — Phase 1
 * Runs only in `hadley dev`. Injected by the Vite plugin.
 *
 * Architecture:
 *  - Edit mode toggle (body.hadley-edit-mode, persisted in sessionStorage)
 *  - Trigger button (⋯) shown by CSS :hover, in sync with the border and background
 *  - Pointing at ⋯ opens the slide-out menu (#hadley-block-menu): ↑ ↓, merge with the block above or below, 🗑
 *  - Edit by right click: in-flow textarea (.hadley-editor) after the block (ADR-10)
 *  - Save → POST /__hadley/patch; Delete → POST /__hadley/delete
 *  - The Vite watcher reloads the page after writes that change the file (ADR-3)
 *  - Mutation lock (ADR-14): disabled after Delete/Move until the reload
 *  - Void elements (<hr>): trigger as a sibling, visibility controlled by JS
 */

// ─── i18n ────────────────────────────────────────────────────────────────────
// The language comes from the page itself, `document.documentElement.lang` (theme templates set
// <html lang="{ meta.lang }">). Server-side error messages (plugin.ts) have their own mirrored
// table (i18n.ts); withLang() appends the same language as a query parameter.

const LANG = document.documentElement.lang === 'de' ? 'de' : 'en'

const T = {
  de: {
    editToggleOn: 'Edit ✓',
    editToggleOff: 'Edit',
    editToggleAriaLabel: 'Edit-Modus umschalten',
    blockActionsLabel: 'Block-Aktionen',
    reloading: 'Wird neu geladen…',
    mergeUpLabel: 'Mit Block darüber zusammenziehen',
    mergeDownLabel: 'Mit Block darunter zusammenziehen',
    moveUpLabel: 'Block nach oben verschieben',
    moveDownLabel: 'Block nach unten verschieben',
    deleteLabel: 'Block löschen',
    fileChangedReload: 'Die Datei wurde extern geändert.\nSeite wird neu geladen.',
    mergeError: (status, msg) => `Fehler beim Zusammenziehen (${status}):\n${msg}`,
    moveError: (status, msg) => `Fehler beim Verschieben (${status}):\n${msg}`,
    deleteError: (status, msg) => `Fehler beim Löschen (${status}):\n${msg}`,
    saveError: (status, msg) => `Fehler beim Speichern (${status}):\n${msg}`,
    loadBlockError: (status) => `Fehler beim Laden des Blocks (${status}).`,
    unknownError: 'Unbekannter Fehler',
    connectionFailed: 'Verbindung zum Server fehlgeschlagen.',
    connectionFailedRetry: 'Verbindung zum Server fehlgeschlagen. Bitte erneut versuchen.',
    connectionFailedDev: 'Verbindung zum Entwicklungsserver fehlgeschlagen.',
    blockGoneReload: 'Block nicht mehr gefunden — Seite wird neu geladen.',
    deleteDialogTitle: 'Block löschen?',
    deleteDialogBody: 'Diese Aktion kann nicht rückgängig gemacht werden.',
    cancel: 'Abbrechen',
    confirmDelete: 'Löschen',
    editAriaLabel: 'Block-Inhalt bearbeiten (Markdown)',
    save: 'Speichern',
    escToCancel: 'Esc = Abbrechen',
    parseError: (msg) => `Parse-Fehler — bitte Text korrigieren:\n\n${msg}`,
    parseErrorElsewhere: (msg) =>
      `Es gibt außerdem einen vorbestehenden Fehler an anderer Stelle im Dokument (nicht in diesem Text):\n\n${msg}`,
  },
  en: {
    editToggleOn: 'Edit ✓',
    editToggleOff: 'Edit',
    editToggleAriaLabel: 'Toggle edit mode',
    blockActionsLabel: 'Block actions',
    reloading: 'Reloading…',
    mergeUpLabel: 'Merge with block above',
    mergeDownLabel: 'Merge with block below',
    moveUpLabel: 'Move block up',
    moveDownLabel: 'Move block down',
    deleteLabel: 'Delete block',
    fileChangedReload: 'The file was changed externally.\nReloading page.',
    mergeError: (status, msg) => `Error merging (${status}):\n${msg}`,
    moveError: (status, msg) => `Error moving (${status}):\n${msg}`,
    deleteError: (status, msg) => `Error deleting (${status}):\n${msg}`,
    saveError: (status, msg) => `Error saving (${status}):\n${msg}`,
    loadBlockError: (status) => `Failed to load block (${status}).`,
    unknownError: 'Unknown error',
    connectionFailed: 'Connection to the server failed.',
    connectionFailedRetry: 'Connection to the server failed. Please try again.',
    connectionFailedDev: 'Connection to the development server failed.',
    blockGoneReload: 'Block no longer found — reloading page.',
    deleteDialogTitle: 'Delete block?',
    deleteDialogBody: 'This action cannot be undone.',
    cancel: 'Cancel',
    confirmDelete: 'Delete',
    editAriaLabel: 'Edit block content (Markdown)',
    save: 'Save',
    escToCancel: 'Esc = Cancel',
    parseError: (msg) => `Parse error — please fix the text:\n\n${msg}`,
    parseErrorElsewhere: (msg) =>
      `There is also a pre-existing error elsewhere in the document (not in this text):\n\n${msg}`,
  },
}[LANG]

// Appends `?lang=` to a /__hadley/* URL so that plugin.ts uses the same language
// for error messages as the UI here.
function withLang(url) {
  return url + (url.includes('?') ? '&' : '?') + `lang=${LANG}`
}

// ─── State ───────────────────────────────────────────────────────────────────

let activeBlockId = null // blockId of the open edit session
let activeWrapper = null // .hadley-editor DOM element
let activeTextarea = null // <textarea> of the open session
let menuBlockEl = null // block whose menu is open
let menuTriggerEl = null // trigger button of the open menu
let menuLeaveTimer = null // debounce for closing the menu automatically
let mutationLocked = false // ADR-14: disabled after Delete/Move until the reload

// ─── Edit mode toggle ────────────────────────────────────────────────────────

const STORAGE_KEY = 'hadley-edit-mode'

function isEditMode() {
  return document.body.classList.contains('hadley-edit-mode')
}

function setEditMode(on) {
  if (on) {
    document.body.classList.add('hadley-edit-mode')
    sessionStorage.setItem(STORAGE_KEY, '1')
  } else {
    document.body.classList.remove('hadley-edit-mode')
    sessionStorage.removeItem(STORAGE_KEY)
    closeEditor()
    closeMenu()
  }
  toggleBtn.textContent = isEditMode() ? T.editToggleOn : T.editToggleOff
}

if (sessionStorage.getItem(STORAGE_KEY)) {
  document.body.classList.add('hadley-edit-mode')
}

const toggleBtn = document.createElement('button')
toggleBtn.id = 'hadley-edit-toggle'
toggleBtn.textContent = isEditMode() ? 'Edit ✓' : 'Edit'
toggleBtn.setAttribute('aria-label', T.editToggleAriaLabel)
toggleBtn.addEventListener('click', () => setEditMode(!isEditMode()))

// ─── Dev bar: dev-overlay + edit toggle together, bottom right ──────────────
const devBar = document.createElement('div')
devBar.id = 'hadley-dev-bar'
const devOverlay = document.querySelector('.dev-overlay')
if (devOverlay) devBar.appendChild(devOverlay)
devBar.appendChild(toggleBtn)
document.body.appendChild(devBar)

// ─── Mutation lock (ADR-14) ──────────────────────────────────────────────────

function lockMutation() {
  mutationLocked = true
  closeMenu()
  toggleBtn.textContent = T.reloading
  toggleBtn.disabled = true
}

// ─── Failures outside requests ───────────────────────────────────────────────

// A reload after an action must not jump to the anchor the page was opened with.
function clearHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
}

// For failures outside a request (an animation, a dialog, the history API): log the cause and tell the user.
function failAction(error) {
  console.error(error)
  alert(`${T.unknownError}: ${error instanceof Error ? error.message : String(error)}`)
}

// ─── SVG icons ───────────────────────────────────────────────────────────────

const _ic = {
  dots: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="3" cy="8" r="2" fill="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor"/><circle cx="13" cy="8" r="2" fill="currentColor"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,10 8,5 13,10"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,6 8,11 13,6"/></svg>',
  merge_top:
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polygon points="8,6 4,13 12,13" fill="currentColor"/></svg>',
  merge_bot:
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><polygon points="8,10 4,3 12,3" fill="currentColor"/><line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  delete:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="4" x2="14" y2="4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M3.2 4l.9 8.5a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.9-8.5"/></svg>',
}

// ─── Slide-out menu (↑ ↓ 🗑) ─────────────────────────────────────────────────

const blockMenu = document.createElement('div')
blockMenu.id = 'hadley-block-menu'
blockMenu.setAttribute('hidden', '')
blockMenu.setAttribute('role', 'menu')

function _mkBtn(cls, icon, label) {
  const b = document.createElement('button')
  b.className = cls
  b.innerHTML = icon
  b.setAttribute('aria-label', label)
  b.setAttribute('role', 'menuitem')
  return b
}

const menuMergeTopBtn = _mkBtn('hadley-menu-merge', _ic.merge_top, T.mergeUpLabel)
const menuMergeBotBtn = _mkBtn('hadley-menu-merge', _ic.merge_bot, T.mergeDownLabel)
const menuUpBtn = _mkBtn('hadley-menu-move', _ic.up, T.moveUpLabel)
const menuDownBtn = _mkBtn('hadley-menu-move', _ic.down, T.moveDownLabel)
const menuDeleteBtn = _mkBtn('hadley-menu-delete', _ic.delete, T.deleteLabel)

function _mkSep() {
  const s = document.createElement('div')
  s.className = 'hadley-menu-sep'
  return s
}

const menuMergeSep = _mkSep()
const menuMoveSep = _mkSep()
blockMenu.append(menuMergeTopBtn, menuMergeBotBtn, menuMergeSep, menuUpBtn, menuDownBtn, menuMoveSep, menuDeleteBtn)
document.body.appendChild(blockMenu)

function openMenu(blockEl, triggerEl) {
  if (mutationLocked || activeBlockId) return
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
  menuMergeTopBtn.style.display = showMergeTop ? '' : 'none'
  menuMergeBotBtn.style.display = showMergeBot ? '' : 'none'
  menuMergeSep.style.display = showMergeTop || showMergeBot ? '' : 'none'
  menuUpBtn.style.display = showMoveUp ? '' : 'none'
  menuDownBtn.style.display = showMoveDown ? '' : 'none'
  menuMoveSep.style.display = showMoveUp || showMoveDown ? '' : 'none'

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
  clearTimeout(menuLeaveTimer)
  menuLeaveTimer = setTimeout(() => {
    menuLeaveTimer = null
    closeMenu()
  }, 500)
}

function cancelMenuClose() {
  clearTimeout(menuLeaveTimer)
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
  if (blockMenu.contains(e.relatedTarget)) return // focus still in the menu
  if (e.relatedTarget === menuTriggerEl) return // focus back on the trigger
  scheduleMenuClose()
})

// Close the menu on a click outside it
document.addEventListener('pointerdown', (e) => {
  if (!menuBlockEl) return
  if (blockMenu.contains(e.target) || blockMenu === e.target) return
  if (menuTriggerEl?.contains(e.target) || menuTriggerEl === e.target) return
  closeMenu()
})

// Close the menu when the pointer leaves it
blockMenu.addEventListener('mouseenter', cancelMenuClose)
blockMenu.addEventListener('mouseleave', (e) => {
  if (!menuBlockEl) return
  if (menuTriggerEl?.contains(e.relatedTarget) || e.relatedTarget === menuTriggerEl) return
  // Into the block content → close at once; outside → close after a delay
  if (menuBlockEl.contains(e.relatedTarget) || e.relatedTarget === menuBlockEl) closeMenu()
  else scheduleMenuClose()
})

// Safety net: mouseleave can be skipped when the mouse moves fast
document.addEventListener('pointermove', (e) => {
  if (!menuBlockEl || activeBlockId || menuLeaveTimer) return
  if (blockMenu.hasAttribute('hidden')) return
  const br = menuBlockEl.getBoundingClientRect()
  const mr = blockMenu.getBoundingClientRect()
  const x = e.clientX,
    y = e.clientY
  const inBlock = x >= br.left && x <= br.right && y >= br.top && y <= br.bottom
  const inMenu = x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom
  if (!inBlock && !inMenu) scheduleMenuClose()
})

// Global Escape handler: editor before menu (the order matters)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (activeBlockId) {
    closeEditor()
    return
  } // editor open → close it (whichever element has focus)
  if (menuBlockEl) closeMenu() // only the menu open → close it
})

// ─── Menu actions ────────────────────────────────────────────────────────────
// Each action handles every failure itself (the request and everything before it), so the handlers do not await it.

menuMergeTopBtn.addEventListener('click', () => {
  if (menuBlockEl) void handleMergeClick(menuBlockEl, 'up')
})
menuMergeBotBtn.addEventListener('click', () => {
  if (menuBlockEl) void handleMergeClick(menuBlockEl, 'down')
})
menuUpBtn.addEventListener('click', () => {
  if (menuBlockEl) void handleMoveClick(menuBlockEl, 'up')
})
menuDownBtn.addEventListener('click', () => {
  if (menuBlockEl) void handleMoveClick(menuBlockEl, 'down')
})
menuDeleteBtn.addEventListener('click', () => {
  if (menuBlockEl) void handleDeleteClick(menuBlockEl)
})

async function animateBlockSwap(blockEl, direction) {
  const allBlocks = [...document.querySelectorAll('[data-hadley-id]')]
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
  lo.style.transition = `transform ${DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`
  hi.style.transition = `transform ${DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`
  lo.style.transform = `translateY(${loTarget - loRect.top}px)`
  hi.style.transform = `translateY(${hiTarget - hiRect.top}px)`

  if (thirdEl && thirdRect && thirdTarget !== undefined) {
    const delta = thirdTarget - thirdRect.top
    if (Math.abs(delta) > 0.5) {
      thirdEl.style.transition = `transform ${DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`
      thirdEl.style.transform = `translateY(${delta}px)`
    }
  }

  await new Promise((r) => setTimeout(r, DURATION))
}

// outline-offset from the CSS: 8px — so that the dashed line of the moving block
// meets the dashed line of its neighbour exactly (and does not pass it).
const OUTLINE_OFFSET = 8

async function animateBlockMerge(blockEl, direction) {
  const allBlocks = [...document.querySelectorAll('[data-hadley-id]')]
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
  blockEl.style.transition = `transform ${DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`
  blockEl.getBoundingClientRect() // reflow
  blockEl.style.transform = `translateY(${translateY}px)`

  await new Promise((r) => setTimeout(r, DURATION))
}

async function handleMergeClick(blockEl, direction) {
  if (mutationLocked) return
  const blockId = blockEl.dataset.hadleyId
  if (!blockId) return

  try {
    closeMenu()
    clearHash()
    await animateBlockMerge(blockEl, direction)
  } catch (error) {
    // The page may show a half-animated state; reloading shows the file as it is.
    failAction(error)
    location.reload()
    return
  }

  try {
    const res = await fetch(withLang('/__hadley/merge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId, direction }),
    })

    if (res.ok) {
      lockMutation()
      return
    }

    const data = await res.json().catch(() => ({}))
    if (res.status === 409) {
      alert(T.fileChangedReload)
      location.reload()
      return
    }
    alert(T.mergeError(res.status, data.error ?? T.unknownError))
  } catch {
    alert(T.connectionFailed)
  }
}

async function handleMoveClick(blockEl, direction) {
  if (mutationLocked) return
  const blockId = blockEl.dataset.hadleyId
  if (!blockId) return

  try {
    closeMenu()
    clearHash()
    await animateBlockSwap(blockEl, direction)
  } catch (error) {
    // The page may show a half-animated state; reloading shows the file as it is.
    failAction(error)
    location.reload()
    return
  }

  try {
    const res = await fetch(withLang('/__hadley/move'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId, direction }),
    })

    if (res.ok) {
      lockMutation()
      return
    }

    const data = await res.json().catch(() => ({}))
    if (res.status === 409) {
      alert(T.fileChangedReload)
      location.reload()
      return
    }
    alert(T.moveError(res.status, data.error ?? T.unknownError))
  } catch {
    alert(T.connectionFailed)
  }
}

function confirmDeleteBlock() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = 'hadley-delete-overlay'

    overlay.innerHTML = `
            <div id="hadley-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="hadley-delete-title">
                <div class="hdd-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="3" y1="5" x2="17" y2="5"/>
                        <path d="M7 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
                        <path d="M4.5 5l1 11a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-11"/>
                    </svg>
                </div>
                <p id="hadley-delete-title" class="hdd-title">${T.deleteDialogTitle}</p>
                <p class="hdd-body">${T.deleteDialogBody}</p>
                <div class="hdd-actions">
                    <button class="hdd-cancel">${T.cancel}</button>
                    <button class="hdd-confirm">${T.confirmDelete}</button>
                </div>
            </div>`

    function done(result) {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        done(false)
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false)
    })
    overlay.querySelector('.hdd-cancel').addEventListener('click', () => done(false))
    overlay.querySelector('.hdd-confirm').addEventListener('click', () => done(true))
    document.addEventListener('keydown', onKey)

    document.body.appendChild(overlay)
    overlay.querySelector('.hdd-cancel').focus()
  })
}

async function animateBlockDelete(blockEl) {
  const allBlocks = [...document.querySelectorAll('[data-hadley-id]')]
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
  blocksAfter.forEach((el) => {
    el.style.transition = `transform ${DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`
    el.style.transform = `translateY(-${gapToFill}px)`
  })

  await new Promise((r) => setTimeout(r, DURATION))
}

async function handleDeleteClick(blockEl) {
  if (mutationLocked) return
  const blockId = blockEl.dataset.hadleyId
  if (!blockId) return

  try {
    closeMenu()
    if (!(await confirmDeleteBlock())) return
    clearHash()
    await animateBlockDelete(blockEl)
  } catch (error) {
    // The page may show a half-animated state; reloading shows the file as it is.
    failAction(error)
    location.reload()
    return
  }

  try {
    const res = await fetch(withLang('/__hadley/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId }),
    })

    if (res.ok) {
      lockMutation()
      return
    }

    const data = await res.json().catch(() => ({}))
    if (res.status === 409) {
      alert(T.fileChangedReload)
      location.reload()
      return
    }
    alert(T.deleteError(res.status, data.error ?? T.unknownError))
  } catch {
    alert(T.connectionFailed)
  }
}

// ─── Trigger buttons + right click ───────────────────────────────────────────
// Non-void: trigger as a child → CSS :hover controls visibility (in sync).
// Void (<hr>): trigger as a sibling → JS mouseenter/leave.

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

function attachBlockListeners() {
  for (const el of document.querySelectorAll('[data-hadley-id]')) {
    const isVoid = VOID_TAGS.has(el.tagName.toLowerCase())

    const trigger = document.createElement('button')
    trigger.className = 'hadley-trigger'
    trigger.innerHTML = _ic.dots
    trigger.setAttribute('aria-label', T.blockActionsLabel)
    trigger.setAttribute('aria-haspopup', 'menu')

    if (isVoid) {
      // Append the trigger to body directly — positioned with getBoundingClientRect, independent of margins
      document.body.appendChild(trigger)

      const positionTrigger = () => {
        const r = el.getBoundingClientRect()
        const size = 26
        Object.assign(trigger.style, {
          position: 'absolute',
          zIndex: '9998',
          top: `${r.top + window.scrollY + (r.height - size) / 2}px`,
          left: `${r.right + window.scrollX - size - 2}px`,
          right: 'auto',
        })
      }

      let leaveTimer = null
      const showTrigger = () => {
        if (!isEditMode() || mutationLocked || activeBlockId) return
        clearTimeout(leaveTimer)
        positionTrigger()
        trigger.classList.add('is-visible')
      }
      const hideTrigger = () => {
        leaveTimer = setTimeout(() => trigger.classList.remove('is-visible'), 120)
      }
      el.addEventListener('mouseenter', showTrigger)
      el.addEventListener('mouseleave', (e) => {
        if (e.relatedTarget === trigger || trigger.contains(e.relatedTarget)) return
        hideTrigger()
      })
      trigger.addEventListener('mouseenter', () => {
        clearTimeout(leaveTimer)
        cancelMenuClose() // stop a running close timer
        if (!isEditMode() || mutationLocked || activeBlockId) return
        openMenu(el, trigger)
      })
      trigger.addEventListener('mouseleave', (e) => {
        if (e.relatedTarget === el || el.contains(e.relatedTarget)) return
        if (blockMenu.contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
        hideTrigger()
        trigger.classList.remove('is-active')
        closeMenu()
      })
    } else {
      // <details> blocks (for example .exkurs) hide every child except <summary> while closed, through a
      // shadow-tree slot — a trigger as a sibling of <summary> would stay invisible. So it goes on <summary>
      // itself, which is always rendered.
      const summary = el.tagName === 'DETAILS' ? el.querySelector(':scope > summary') : null
      if (summary) {
        summary.appendChild(trigger)
        // A click on a control inside <summary> would otherwise also trigger the native
        // open/close.
        trigger.addEventListener('click', (e) => e.preventDefault())
      } else {
        el.appendChild(trigger)
      }
    }

    trigger.addEventListener('mouseenter', () => {
      cancelMenuClose() // stop a running close timer (for example after leaving the menu)
      if (!isEditMode() || mutationLocked || activeBlockId) return
      openMenu(el, trigger)
    })

    // Pointer leaves the trigger → close at once, unless it moves into the menu
    trigger.addEventListener('mouseleave', (e) => {
      if (blockMenu.contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
      closeMenu()
    })

    // Close the menu when the trigger loses focus (keyboard navigation)
    trigger.addEventListener('blur', (e) => {
      if (blockMenu.contains(e.relatedTarget)) return // focus moves into the menu
      scheduleMenuClose()
    })

    // Close the menu when the pointer leaves the block without entering the menu
    el.addEventListener('mouseenter', (e) => {
      if (menuBlockEl !== el) return
      // Do not cancel when the pointer comes from the menu — that is an intended leave
      if (blockMenu.contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
      cancelMenuClose()
    })
    el.addEventListener('mouseleave', (e) => {
      if (menuBlockEl !== el) return
      if (blockMenu.contains(e.relatedTarget) || e.relatedTarget === blockMenu) return
      scheduleMenuClose()
    })

    // Right click opens the editor (bound directly, bypasses stopPropagation in theme JS)
    el.addEventListener('contextmenu', (e) => {
      if (!isEditMode() || activeBlockId || mutationLocked) return
      e.preventDefault()
      e.stopPropagation()
      const blockId = el.dataset.hadleyId
      if (blockId) void handleEditClick(blockId, el)
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachBlockListeners)
} else {
  attachBlockListeners()
}

// ─── Edit: load the block text and open the editor ────────────────────────────

async function handleEditClick(blockId, blockEl) {
  if (activeBlockId) return
  closeMenu()

  let text
  try {
    const res = await fetch(withLang(`/__hadley/block/${blockId}`))
    if (!res.ok) {
      // 409: the file changed since the page was rendered, and its blocks moved
      if (res.status === 404 || res.status === 409) {
        alert(T.blockGoneReload)
        clearHash()
        location.reload()
        return
      }
      alert(T.loadBlockError(res.status))
      return
    }
    const data = await res.json()
    text = data.text
  } catch {
    alert(T.connectionFailedDev)
    return
  }

  try {
    openEditor(blockId, blockEl, text)
  } catch (error) {
    // openEditor sets activeBlockId first; without this reset no block could be edited any more.
    closeEditor()
    failAction(error)
  }
}

// ─── Open the editor ─────────────────────────────────────────────────────────

function openEditor(blockId, blockEl, text) {
  activeBlockId = blockId
  document.body.classList.add('hadley-editing')

  const wrapper = document.createElement('div')
  wrapper.className = 'hadley-editor'

  const textarea = document.createElement('textarea')
  textarea.className = 'hadley-textarea'
  textarea.value = text
  textarea.setAttribute('aria-label', T.editAriaLabel)
  textarea.setAttribute('spellcheck', 'false')

  const editorToolbar = document.createElement('div')
  editorToolbar.className = 'hadley-editor-toolbar'

  const saveBtn = document.createElement('button')
  saveBtn.className = 'hadley-save-btn'
  saveBtn.type = 'button'
  saveBtn.textContent = T.save

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'hadley-cancel-btn'
  cancelBtn.type = 'button'
  cancelBtn.textContent = T.cancel

  const hint = document.createElement('span')
  hint.className = 'hadley-toolbar-hint'
  hint.textContent = T.escToCancel

  editorToolbar.append(saveBtn, cancelBtn, hint)
  wrapper.append(textarea, editorToolbar)
  blockEl.insertAdjacentElement('afterend', wrapper)

  activeWrapper = wrapper
  activeTextarea = textarea

  textarea.focus()
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length

  textarea.addEventListener('input', () => resizeTextarea(textarea))
  resizeTextarea(textarea)

  saveBtn.addEventListener('click', () => void saveEditor(blockId, saveBtn))
  cancelBtn.addEventListener('click', closeEditor)
}

function resizeTextarea(ta) {
  if (ta.scrollHeight > ta.clientHeight) {
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.6)}px`
  }
}

// ─── Close the editor ────────────────────────────────────────────────────────

function closeEditor() {
  activeWrapper?.remove()
  activeWrapper = null
  activeTextarea = null
  activeBlockId = null
  document.body.classList.remove('hadley-editing')
}

// ─── Save ────────────────────────────────────────────────────────────────────

// On 422, plugin.ts also sends `errors` (Diagnostic.range, markanto-js ≥0.1.1), each with `local`: does the error
// overlap the block being edited? plugin.ts refuses an edit only for a `local` error; an integrity check makes sure
// no other block changed meaning. The message tells "you broke this" apart from "the error already exists elsewhere
// in the document". Without `errors` (an older server, or a refusal by the integrity check) it falls back to the
// old message that makes no such distinction.
function buildParseErrorMessage(data) {
  const errors = Array.isArray(data.errors) ? data.errors : null
  if (!errors || errors.length === 0) return T.parseError(data.error ?? '')

  const local = errors.filter((e) => e.local).map((e) => e.message)
  const elsewhere = errors.filter((e) => !e.local).map((e) => e.message)

  const parts = []
  if (local.length) parts.push(T.parseError(local.join('; ')))
  if (elsewhere.length) parts.push(T.parseErrorElsewhere(elsewhere.join('; ')))
  return parts.join('\n\n')
}

async function saveEditor(blockId, saveBtn) {
  const newText = activeTextarea?.value
  if (newText === undefined) return

  saveBtn.disabled = true
  try {
    clearHash()
  } catch (error) {
    failAction(error)
    saveBtn.disabled = false
    return
  }

  try {
    const res = await fetch(withLang('/__hadley/patch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId, newText }),
    })

    if (res.ok) {
      closeEditor()
      return
    }

    const data = await res.json().catch(() => ({}))

    if (res.status === 409) {
      alert(T.fileChangedReload)
      location.reload()
      return
    }

    if (res.status === 422) {
      alert(buildParseErrorMessage(data))
      saveBtn.disabled = false
      activeTextarea?.focus()
      return
    }

    alert(T.saveError(res.status, data.error ?? T.unknownError))
    saveBtn.disabled = false
  } catch {
    alert(T.connectionFailedRetry)
    saveBtn.disabled = false
  }
}
