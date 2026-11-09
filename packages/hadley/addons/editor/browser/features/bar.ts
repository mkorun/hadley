// The dev bar, bottom right: the dev overlay and one control, a pill. Edit mode at its left, kept in sessionStorage,
// and the editor's language, as it is, with a menu of the others (Michael, 2026-11-09: "EN" on a German editor,
// the language it would switch to, was confusing); the chat add-on puts its own half at its right (addons/chat).
import { el } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { state, isEditMode } from '../core/state.ts'
import { LANG, LANG_KEY, LANG_NAMES, LANGS, T, type Lang } from '../core/texts.ts'

const STORAGE_KEY = 'hadley-edit-mode'

export interface Bar {
  /** the toggle as edit mode is */
  draw(): void
  /** the toggle while the page reloads after a change (ADR-14) */
  reloading(): void
}

/** The bar, in the body; `leave` runs when edit mode turns off, `changed` after each switch. */
export function bar(on: { leave(): void; changed(): void }): Bar {
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) document.body.classList.add('hadley-edit-mode')
  } catch {
    // Edit mode remains available on this page without persistence.
  }

  const toggle = el('button')
  toggle.id = 'hadley-edit-toggle'
  toggle.type = 'button'
  toggle.textContent = T.editLabel
  toggle.setAttribute('aria-label', T.editToggleAriaLabel)
  toggle.setAttribute('aria-pressed', String(isEditMode()))

  /** The toggle: a pencil and its label, in the accent while edit mode is on (aria-pressed). */
  const draw = () => {
    toggle.replaceChildren(icon('pencil'))
    toggle.append(Object.assign(el('span'), { textContent: T.editLabel }))
    toggle.setAttribute('aria-pressed', String(isEditMode()))
  }

  const setEditMode = (turnOn: boolean) => {
    if (turnOn) {
      document.body.classList.add('hadley-edit-mode')
    } else {
      document.body.classList.remove('hadley-edit-mode')
      on.leave()
    }
    try {
      if (turnOn) sessionStorage.setItem(STORAGE_KEY, '1')
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Disabling browser storage must not disable either dev tool.
    }
    draw()
    on.changed()
  }
  toggle.addEventListener('click', () => setEditMode(!isEditMode()))

  const devBar = el('div')
  devBar.id = 'hadley-dev-bar'
  const devOverlay = document.querySelector('.dev-overlay')
  if (devOverlay) devBar.appendChild(devOverlay)
  const pill = el('div', 'hadley-pill')
  pill.appendChild(toggle)
  // the editor's language and a menu of all it speaks; the page reloads in the one chosen, so an open block must be
  // saved or cancelled first
  const langBtn = el('button')
  langBtn.type = 'button'
  langBtn.id = 'hadley-lang-toggle'
  langBtn.textContent = LANG.toUpperCase()
  langBtn.append(Object.assign(el('span', 'hadley-lang-caret'), { textContent: '▾' }))
  langBtn.setAttribute('aria-label', `${T.langMenu}: ${LANG_NAMES[LANG]}`)
  langBtn.title = T.langMenu
  langBtn.setAttribute('aria-haspopup', 'menu')
  langBtn.setAttribute('aria-expanded', 'false')
  langBtn.setAttribute('aria-controls', 'hadley-lang-menu')
  const langMenu = el('div', 'hadley-lang-menu')
  langMenu.id = 'hadley-lang-menu'
  langMenu.setAttribute('role', 'menu')
  langMenu.setAttribute('aria-label', T.langMenu)
  langMenu.hidden = true
  const choose = (lang: Lang) => {
    if (lang === LANG) return showMenu(false)
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      return showMenu(false)
    }
    location.reload()
  }
  for (const lang of LANGS) {
    const item = el('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-checked', String(lang === LANG))
    item.lang = lang
    item.textContent = LANG_NAMES[lang]
    item.addEventListener('click', () => choose(lang))
    langMenu.append(item)
  }
  const showMenu = (open: boolean) => {
    langMenu.hidden = !open
    langBtn.setAttribute('aria-expanded', String(open))
    if (open) langMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }
  langBtn.addEventListener('click', () => {
    if (state.block) {
      langBtn.title = T.langSwitchBusy
      return
    }
    showMenu(langMenu.hidden !== false)
  })
  langMenu.addEventListener('keydown', (e) => {
    const items = [...langMenu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.stopPropagation()
      showMenu(false)
      langBtn.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    }
  })
  document.addEventListener('click', (e) => {
    if (!langMenu.hidden && !langMenu.contains(e.target as Node) && !langBtn.contains(e.target as Node)) showMenu(false)
  })
  pill.appendChild(langBtn)
  // above the pill, which clips what overflows it
  devBar.append(langMenu, pill)
  document.body.appendChild(devBar)

  return {
    draw,
    reloading() {
      toggle.textContent = T.reloading
      toggle.disabled = true
    },
  }
}
