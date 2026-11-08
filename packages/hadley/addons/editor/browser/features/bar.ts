// The dev bar, bottom right: the dev overlay and one control, a pill. Edit mode at its left, kept in sessionStorage,
// and the other language, one click away; the chat add-on puts its own half at its right (addons/chat).
import { el } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { state, isEditMode } from '../core/state.ts'
import { LANG, LANG_KEY, T } from '../core/texts.ts'

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
  // the other language, one click away; the page reloads in it, so an open block must be saved or cancelled first
  const langBtn = el('button')
  langBtn.type = 'button'
  langBtn.id = 'hadley-lang-toggle'
  langBtn.textContent = LANG === 'de' ? 'EN' : 'DE'
  langBtn.setAttribute('aria-label', T.langSwitch)
  langBtn.title = T.langSwitch
  langBtn.addEventListener('click', () => {
    if (state.block) {
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

  return {
    draw,
    reloading() {
      toggle.textContent = T.reloading
      toggle.disabled = true
    },
  }
}
