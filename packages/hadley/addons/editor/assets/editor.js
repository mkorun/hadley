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
// The editor is the author's tool, not part of the page: it speaks the first of the browser's languages it knows
// (navigator.languages), else English, whatever the page's own language; the language switch in the control at the
// bottom right overrides it for the site, kept in localStorage. Server-side error messages (plugin.ts) have their own
// mirrored table (i18n.ts); withLang() appends the same language as a query parameter. The chat (addons/chat) reads it
// from the root element's data-hadley-lang.

const LANGS = ['de', 'en']
const LANG_KEY = 'hadley-lang'

function chooseLang() {
  try {
    const chosen = localStorage.getItem(LANG_KEY)
    if (LANGS.includes(chosen)) return chosen
  } catch {
    // without storage the browser's languages decide
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).toLowerCase().split('-')[0]
    if (LANGS.includes(base)) return base
  }
  return 'en'
}

const LANG = chooseLang()
document.documentElement.dataset.hadleyLang = LANG

const T = {
  de: {
    editLabel: 'Bearbeiten',
    limaUnavailable: 'Lima ließ sich nicht laden: Keys und Fehler zeigt erst das Speichern',
    langSwitch: 'Editor auf Englisch',
    langSwitchBusy: 'Erst den offenen Block speichern oder abbrechen',
    editToggleAriaLabel: 'Edit-Modus umschalten',
    blockActionsLabel: 'Block-Aktionen',
    reloading: 'Wird neu geladen…',
    mergeUpLabel: 'Mit Block darüber zusammenziehen',
    mergeDownLabel: 'Mit Block darunter zusammenziehen',
    moveUpLabel: 'Block nach oben verschieben',
    moveDownLabel: 'Block nach unten verschieben',
    deleteLabel: 'Block löschen',
    addBelowLabel: 'Neuer Block darunter',
    filesLabel: 'Dateien im Bundle',
    insertFile: (name) => `${name} einfügen`,
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
    frontMatter: 'Front Matter',
    escToCancel: 'Abbrechen (Esc)',
    saveShortcut: 'Speichern (Strg+S)',
    parseError: (msg) => `Parse-Fehler — bitte Text korrigieren:\n\n${msg}`,
    parseErrorElsewhere: (msg) =>
      `Es gibt außerdem einen vorbestehenden Fehler an anderer Stelle im Dokument (nicht in diesem Text):\n\n${msg}`,
  },
  en: {
    editLabel: 'Edit',
    limaUnavailable: 'Lima could not be loaded: keys and errors show only when saving',
    langSwitch: 'Editor in German',
    langSwitchBusy: 'Save or cancel the open block first',
    editToggleAriaLabel: 'Toggle edit mode',
    blockActionsLabel: 'Block actions',
    reloading: 'Reloading…',
    mergeUpLabel: 'Merge with block above',
    mergeDownLabel: 'Merge with block below',
    moveUpLabel: 'Move block up',
    moveDownLabel: 'Move block down',
    deleteLabel: 'Delete block',
    addBelowLabel: 'New block below',
    filesLabel: 'Files in the bundle',
    insertFile: (name) => `Insert ${name}`,
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
    frontMatter: 'Front matter',
    escToCancel: 'Cancel (Esc)',
    saveShortcut: 'Save (Ctrl+S)',
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
// a new block below: the text of the block it follows, saved with it (openEditor's `after`), or null
let activeAfter = null
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
  } else {
    document.body.classList.remove('hadley-edit-mode')
    closeEditor()
    closeMenu()
  }
  try {
    if (on) sessionStorage.setItem(STORAGE_KEY, '1')
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Disabling browser storage must not disable either dev tool.
  }
  drawToggle()
  queueFrames()
}

try {
  if (sessionStorage.getItem(STORAGE_KEY)) document.body.classList.add('hadley-edit-mode')
} catch {
  // Edit mode remains available on this page without persistence.
}

const toggleBtn = document.createElement('button')
toggleBtn.id = 'hadley-edit-toggle'
toggleBtn.type = 'button'
toggleBtn.textContent = T.editLabel
toggleBtn.setAttribute('aria-label', T.editToggleAriaLabel)
toggleBtn.setAttribute('aria-pressed', String(isEditMode()))
toggleBtn.addEventListener('click', () => setEditMode(!isEditMode()))

/** The toggle: a pencil and its label, in the accent while edit mode is on (aria-pressed). */
function drawToggle() {
  toggleBtn.innerHTML = _ic.pencil
  toggleBtn.append(Object.assign(document.createElement('span'), { textContent: T.editLabel }))
  toggleBtn.setAttribute('aria-pressed', String(isEditMode()))
}

// ─── Dev bar: dev-overlay and one control, bottom right ─────────────────────
// The control is a pill: edit mode at its left; the chat add-on puts its own half at its right (addons/chat).
const devBar = document.createElement('div')
devBar.id = 'hadley-dev-bar'
const devOverlay = document.querySelector('.dev-overlay')
if (devOverlay) devBar.appendChild(devOverlay)
const pill = document.createElement('div')
pill.className = 'hadley-pill'
pill.appendChild(toggleBtn)
// the other language, one click away; the page reloads in it, so an open block must be saved or cancelled first
const langBtn = document.createElement('button')
langBtn.type = 'button'
langBtn.id = 'hadley-lang-toggle'
langBtn.textContent = LANG === 'de' ? 'EN' : 'DE'
langBtn.setAttribute('aria-label', T.langSwitch)
langBtn.title = T.langSwitch
langBtn.addEventListener('click', () => {
  if (activeBlockId) {
    langBtn.title = T.langSwitchBusy
    return
  }
  try {
    localStorage.setItem(LANG_KEY, LANG === 'de' ? 'en' : 'de')
  } catch {
    return
  }
  location.reload()
})
pill.appendChild(langBtn)
devBar.appendChild(pill)
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

// One set of icons for the whole editor (and the chat, addons/chat/assets/chat.js): a 16 × 16 grid, lines of 1.6 with
// round ends and joins, no fill, in currentColor, so that each takes the colour and contrast of its control.
const _ic = {
  dots: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
  merge_top:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h10M8 13V6.5M5 9.5l3-3 3 3"/></svg>',
  merge_bot:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h10M8 3v6.5M5 6.5l3 3 3-3"/></svg>',
  delete:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M7 7v3.5M9 7v3.5"/></svg>',
  add: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  file: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3"/></svg>',
  pencil:
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3"/></svg>',
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

const menuAddBtn = _mkBtn('hadley-menu-add', _ic.add, T.addBelowLabel)
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

const menuAddSep = _mkSep()
const menuMergeSep = _mkSep()
const menuMoveSep = _mkSep()
blockMenu.append(
  menuAddBtn,
  menuAddSep,
  menuMergeTopBtn,
  menuMergeBotBtn,
  menuMergeSep,
  menuUpBtn,
  menuDownBtn,
  menuMoveSep,
  menuDeleteBtn,
)
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

// Ctrl+S (Cmd+S on a Mac) saves the open block, not the page
document.addEventListener('keydown', (e) => {
  if (!activeBlockId || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
  e.preventDefault()
  activeWrapper?.querySelector('.hadley-save-btn')?.click()
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
menuAddBtn.addEventListener('click', () => {
  const blockId = menuBlockEl?.dataset.hadleyId
  if (menuBlockEl && blockId) void handleEditClick(blockId, menuBlockEl, { below: true })
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

    trigger.addEventListener('click', () => {
      if (!isEditMode() || mutationLocked || activeBlockId) return
      openMenu(el, trigger)
    })
    trigger.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return
      if (!isEditMode() || mutationLocked || activeBlockId) return
      e.preventDefault()
      openMenu(el, trigger)
      blockMenu.querySelector('button:not([style*="none"])')?.focus()
    })

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

// ─── The page's head: its title and subtitle, edited where the theme shows them ──────
//
// hadley takes the title and subtitle out of the text, and the theme shows them where it likes; in a dev build it marks
// them, data-hadley-head="title" and "subtitle" (docs/themes.md). The dev server names the block that edits each, its
// line of Markdown or the front matter that gives it; a right click opens it as any block, without a block menu.

async function attachHeadListeners() {
  let heads
  try {
    const res = await fetch(withLang(`/__hadley/heads?path=${encodeURIComponent(location.pathname)}`))
    if (!res.ok) return
    heads = await res.json()
  } catch {
    return
  }
  for (const which of ['title', 'subtitle']) {
    const head = heads?.[which]
    if (!head || typeof head.id !== 'string') continue
    const el = document.querySelector(`[data-hadley-head="${which}"]`)
    if (!el) continue
    el.dataset.hadleyHeadEditable = ''
    // the front matter, where it gives the title or subtitle, is Lima, not text to rewrite (addons/chat)
    if (head.from === 'front matter') el.dataset.hadleyFrontMatter = ''
    el.addEventListener('contextmenu', (e) => {
      if (!isEditMode() || activeBlockId || mutationLocked) return
      e.preventDefault()
      e.stopPropagation()
      void handleEditClick(head.id, el)
    })
  }
  // the front matter, from a badge right above the title, shown in edit mode only
  const title = document.querySelector('[data-hadley-head="title"]')
  if (heads?.frontMatter && typeof heads.frontMatter.id === 'string' && title) {
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'hadley-front-matter-badge'
    badge.innerHTML = _ic.pencil
    badge.append(T.frontMatter)
    badge.dataset.hadleyFrontMatter = ''
    badge.addEventListener('click', () => {
      if (!isEditMode() || activeBlockId || mutationLocked) return
      void handleEditClick(heads.frontMatter.id, badge)
    })
    title.before(badge)
  }
}

// ─── Frames: what can be edited, visible on any ground ──────────────────────────
//
// A frame is two tones, a dark line and a light one, so one of them stands out from a light page, a dark one, a dark
// area of a light page or a picture. It cannot be the block's own outline (one tone) or box-shadow (it fills the gap
// to the block), nor a child of the block (a code block's overflow would clip it). So the frames have a layer of their
// own over the page, z-index 1: under a site's fixed or sticky bars, above the text. They follow the blocks through
// resizes, changes to the page and the move animations.

const FRAMED = '[data-hadley-id], [data-hadley-head-editable]'
const frameLayer = document.createElement('div')
frameLayer.id = 'hadley-frames'
frameLayer.setAttribute('aria-hidden', 'true')
const frames = new Map()
let framesQueued = false
let framesMovingUntil = 0

function placeFrames() {
  framesQueued = false
  if (!isEditMode()) {
    frameLayer.hidden = true
    return
  }
  frameLayer.hidden = false
  const seen = new Set()
  for (const el of document.querySelectorAll(FRAMED)) {
    seen.add(el)
    let frame = frames.get(el)
    if (!frame) {
      frame = document.createElement('div')
      frame.className = 'hadley-frame'
      frameLayer.append(frame)
      frames.set(el, frame)
      frameObserver.observe(el)
    }
    const r = el.getBoundingClientRect()
    frame.hidden = r.width === 0 && r.height === 0
    if (frame.hidden) continue
    // 8px off the block on every side, as far as the tint of a hovered block reaches (editor.css)
    Object.assign(frame.style, {
      top: `${r.top + window.scrollY - 8}px`,
      left: `${r.left + window.scrollX - 8}px`,
      width: `${r.width + 16}px`,
      height: `${r.height + 16}px`,
    })
    frame.classList.toggle('is-hover', el.matches(':hover'))
    frame.classList.toggle('is-active', el.classList.contains('hadley-block-active'))
  }
  for (const [el, frame] of frames) {
    if (seen.has(el)) continue
    frame.remove()
    frames.delete(el)
    frameObserver.unobserve(el)
  }
  // while a block moves (the move animations), every frame, for a second at most
  if (performance.now() < framesMovingUntil) queueFrames()
}

function queueFrames() {
  if (framesQueued) return
  framesQueued = true
  requestAnimationFrame(placeFrames)
}

const frameObserver = new ResizeObserver(queueFrames)

function startFrames() {
  document.body.append(frameLayer)
  frameObserver.observe(document.documentElement)
  new MutationObserver((records) => {
    if (records.some((record) => record.target !== frameLayer && !frameLayer.contains(record.target))) queueFrames()
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  document.addEventListener('pointerover', queueFrames, { passive: true })
  document.addEventListener('pointerout', queueFrames, { passive: true })
  // a frame in a fixed or sticky area moves with the scroll
  window.addEventListener('scroll', queueFrames, { passive: true })
  document.addEventListener('transitionrun', (e) => {
    if (e.propertyName !== 'transform' || !(e.target instanceof Element) || !e.target.matches(FRAMED)) return
    framesMovingUntil = performance.now() + 1000
    queueFrames()
  })
  document.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform' && e.target instanceof Element && e.target.matches(FRAMED)) queueFrames()
  })
  void document.fonts?.ready.then(queueFrames)
  queueFrames()
}

function attachListeners() {
  drawToggle()
  attachBlockListeners()
  void attachHeadListeners().then(queueFrames)
  startFrames()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachListeners)
} else {
  attachListeners()
}

// ─── Edit: load the block text and open the editor ────────────────────────────

async function handleEditClick(blockId, blockEl, { below = false } = {}) {
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
    // a new block below is an edit of the block above: its text, a blank line, and what is written in the empty field;
    // the server checks it as any edit (hash, Markanto, nothing else changed)
    if (below) openEditor(blockId, blockEl, '', { after: text })
    else openEditor(blockId, blockEl, text)
  } catch (error) {
    // openEditor sets activeBlockId first; without this reset no block could be edited any more.
    closeEditor()
    failAction(error)
  }
}

// ─── Open the editor ─────────────────────────────────────────────────────────

function openEditor(blockId, blockEl, text, { after = null } = {}) {
  activeBlockId = blockId
  activeAfter = after
  document.body.classList.add('hadley-editing')

  const wrapper = document.createElement('div')
  wrapper.className = 'hadley-editor'

  const textarea = document.createElement('textarea')
  textarea.className = 'hadley-textarea'
  textarea.value = text
  textarea.setAttribute('aria-label', T.editAriaLabel)
  textarea.setAttribute('spellcheck', 'true')

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
  cancelBtn.title = T.escToCancel
  saveBtn.title = T.saveShortcut

  editorToolbar.append(saveBtn, cancelBtn)
  const frontMatter = blockEl.dataset.hadleyFrontMatter !== undefined
  wrapper.append(frontMatter ? limaTable(textarea) : textarea, editorToolbar)
  blockEl.insertAdjacentElement('afterend', wrapper)
  if (!frontMatter) void bundleFiles(blockId, textarea, editorToolbar)

  activeWrapper = wrapper
  activeTextarea = textarea

  textarea.focus()
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length

  textarea.addEventListener('input', () => resizeTextarea(textarea))
  resizeTextarea(textarea)

  saveBtn.addEventListener('click', () => void saveEditor(blockId, saveBtn))
  cancelBtn.addEventListener('click', closeEditor)
  document.dispatchEvent(
    new CustomEvent('hadley:editor-open', {
      detail: {
        block: blockId,
        // the front matter is Lima, which the chat does not rewrite
        frontMatter,
        textarea,
        wrapper,
        insert(start, end, replacement) {
          if (activeTextarea !== textarea) return false
          textarea.focus()
          textarea.setSelectionRange(start, end)
          // insertText participates in the browser's native undo history; assigning value does not.
          const inserted = document.execCommand('insertText', false, replacement)
          // what came in stays selected, so that it shows, and the next action rewrites it again
          if (inserted) textarea.setSelectionRange(start, start + replacement.length)
          resizeTextarea(textarea)
          return inserted
        },
      },
    }),
  )
}

// ─── The files of the bundle ────────────────────────────────────────────────────
//
// Under the field, the files that lie beside the page's Markdown (the dev server lists them, plugin.ts): a click puts
// one in at the caret, an image as `![](name)` with the caret in its alt text, any other file as a link. The text stays
// text: what it says is saved as any edit.

async function bundleFiles(blockId, textarea, toolbar) {
  let files
  try {
    const res = await fetch(withLang(`/__hadley/files/${blockId}`))
    if (!res.ok) return
    files = (await res.json()).files
  } catch {
    return
  }
  if (!Array.isArray(files) || files.length === 0 || activeTextarea !== textarea) return
  const strip = document.createElement('div')
  strip.className = 'hadley-files'
  strip.setAttribute('role', 'group')
  strip.setAttribute('aria-label', T.filesLabel)
  for (const file of files) {
    if (typeof file?.name !== 'string') continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'hadley-file'
    button.title = T.insertFile(file.name)
    button.setAttribute('aria-label', T.insertFile(file.name))
    if (file.image) {
      const img = document.createElement('img')
      img.src = `/__hadley/files/${blockId}/${encodeURIComponent(file.name)}`
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      button.append(img)
    } else {
      button.insertAdjacentHTML('afterbegin', _ic.file)
    }
    const name = document.createElement('span')
    name.textContent = file.name
    button.append(name)
    // the field keeps the focus and its caret
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', () => {
      const start = textarea.selectionStart
      const link = file.image ? `![](${file.name})` : `[${file.name}](${file.name})`
      textarea.focus()
      document.execCommand('insertText', false, link)
      // an image waits for its alt text, a link is done
      const caret = file.image ? start + 2 : start + link.length
      textarea.setSelectionRange(caret, caret)
      resizeTextarea(textarea)
    })
    strip.append(button)
  }
  toolbar.before(strip)
}

// ─── The front matter as a table ────────────────────────────────────────────────
//
// The front matter is Lima: its lines are striped, its keys stand out and its comments step back, each where Lima's
// outline() finds it (@limaformat/lima, served by the dev server), so that `Autor:in: x` has the key `Autor:in` and a
// line of a `|` scalar has none. A layer under the textarea draws it; the textarea, its text transparent, keeps the
// caret, the selection, undo and everything else a textarea does. A line Lima refuses is marked as it is typed, its
// message below.

let limaOutline = null
let limaLoading = null
let limaFailed = false

function loadLima() {
  limaLoading ??= import('/__hadley/lima/index.js')
    .then((lima) => {
      limaOutline = lima.outline
    })
    .catch(() => {
      // without Lima the lines are still striped, and the table says that it checks nothing (review 2026-11-05)
      limaFailed = true
    })
  return limaLoading
}

function limaTable(textarea) {
  const table = document.createElement('div')
  table.className = 'hadley-fm'
  const layer = document.createElement('div')
  layer.className = 'hadley-fm-layer'
  layer.setAttribute('aria-hidden', 'true')
  const status = document.createElement('p')
  status.className = 'hadley-fm-status'
  status.setAttribute('role', 'status')
  status.hidden = true
  const box = document.createElement('div')
  box.className = 'hadley-fm-box'
  textarea.setAttribute('spellcheck', 'false')
  box.append(layer, textarea)
  table.append(box, status)
  // keys in bold only where the font gives bold letters the same width, else the caret would stand beside its letter
  const probe = (weight) => {
    const span = document.createElement('span')
    span.textContent = 'abcdefghijklmnopqrstuvwxyz_:ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    span.style.fontWeight = weight
    layer.append(span)
    const width = span.getBoundingClientRect().width
    span.remove()
    return width
  }
  requestAnimationFrame(() => {
    if (Math.abs(probe('700') - probe('400')) < 0.5) table.dataset.boldKeys = ''
  })

  const draw = () => {
    const text = textarea.value
    const marks = new Map() // line → [{ from, to, kind }], columns from 0
    const mark = (span, kind) => {
      const { line, column } = span.start
      // a span ends on its own line: keys and comments never run over one
      const to = span.end.line === line ? span.end.column - 1 : Infinity
      if (!marks.has(line)) marks.set(line, [])
      marks.get(line).push({ from: column - 1, to, kind })
    }
    let errors = []
    if (limaOutline) {
      const result = limaOutline(text)
      for (const key of result.keys) mark(key.span, 'key')
      for (const comment of result.comments) mark(comment, 'comment')
      errors = result.diagnostics
    }
    const errorLines = new Set(errors.map((d) => d.line))
    const rows = text.split('\n').map((line, index) => {
      const row = document.createElement('div')
      row.className = 'hadley-fm-line'
      if (errorLines.has(index + 1)) row.classList.add('is-error')
      let at = 0
      for (const { from, to, kind } of (marks.get(index + 1) ?? []).sort((a, b) => a.from - b.from)) {
        if (from < at) continue
        if (from > at) row.append(line.slice(at, from))
        const part = document.createElement('span')
        part.className = `hadley-fm-${kind}`
        part.textContent = line.slice(from, Math.min(to, line.length))
        row.append(part)
        at = Math.min(to, line.length)
      }
      if (at < line.length) row.append(line.slice(at))
      return row
    })
    layer.replaceChildren(...rows)
    layer.scrollTop = textarea.scrollTop
    // Lima's message names the line itself
    status.textContent = errors[0]?.message ?? (limaFailed ? T.limaUnavailable : '')
    status.hidden = !status.textContent
  }
  textarea.addEventListener('input', draw)
  textarea.addEventListener('scroll', () => {
    layer.scrollTop = textarea.scrollTop
  })
  draw()
  void loadLima().then(draw)
  return table
}

function resizeTextarea(ta) {
  if (ta.scrollHeight > ta.clientHeight) {
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.6)}px`
  }
}

// ─── Close the editor ────────────────────────────────────────────────────────

function closeEditor() {
  document.dispatchEvent(new CustomEvent('hadley:editor-close'))
  activeWrapper?.remove()
  activeWrapper = null
  activeTextarea = null
  activeBlockId = null
  activeAfter = null
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
  const written = activeTextarea?.value
  if (written === undefined) return
  // an empty new block is no edit
  if (activeAfter !== null && !written.trim()) {
    closeEditor()
    return
  }
  const newText = activeAfter !== null ? `${activeAfter}\n\n${written}` : written

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
