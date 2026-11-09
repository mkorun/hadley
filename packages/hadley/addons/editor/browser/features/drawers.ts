// The open field's tools that are seldom needed, folded away (Michael, 2026-11-09: "Ausklappen ist deutlich besser"):
// a quiet toggle for each at the right of the toolbar, its drawer under it, so that the text always stays in view.
// One drawer open at a time; the one open last opens again with the next field, kept in localStorage. The bundle's
// files (files.ts) and the chat's rewrite (addons/chat, by `hadley:editor-open`) each have one.
import { el } from '../core/dom.ts'

const KEY = 'hadley-drawer'
const ORDER = ['files', 'rewrite'] as const
export type DrawerKey = (typeof ORDER)[number]

export interface Drawers {
  /** the drawer of `key`, its toggle labelled `label` beside `symbol`; made once, a second call only relabels it */
  drawer(key: DrawerKey, label: string, symbol: Element): HTMLElement
  /** the drawer of `key` open, the others closed, as a click on its toggle would; not remembered */
  open(key: DrawerKey): void
  /** the drawer of `key` and its toggle gone, as when nothing is left in it (the last file of a bundle) */
  remove(key: DrawerKey): void
}

const remembered = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

const remember = (key: string): void => {
  try {
    localStorage.setItem(KEY, key)
  } catch {
    // without storage the drawers start folded
  }
}

/** The drawers of the field whose toolbar is `toolbar`: toggles at its right, drawers right under it. */
export function drawers(toolbar: HTMLElement): Drawers {
  const made = new Map<DrawerKey, { toggle: HTMLButtonElement; label: HTMLElement; panel: HTMLElement }>()
  toolbar.append(el('span', 'hadley-drawer-space'))

  const open = (key: DrawerKey | null) => {
    for (const [k, { toggle, panel }] of made) {
      toggle.setAttribute('aria-expanded', String(k === key))
      panel.hidden = k !== key
    }
  }

  return {
    open: (key) => open(key),
    remove(key) {
      const known = made.get(key)
      if (!known) return
      known.toggle.remove()
      known.panel.remove()
      made.delete(key)
    },
    drawer(key, text, symbol) {
      const known = made.get(key)
      if (known) {
        known.label.textContent = text
        known.panel.setAttribute('aria-label', text)
        return known.panel
      }
      const toggle = el('button', 'hadley-drawer-toggle')
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.setAttribute('aria-controls', `hadley-drawer-${key}`)
      const label = el('span')
      label.textContent = text
      const chevron = el('span', 'hadley-drawer-chevron')
      chevron.setAttribute('aria-hidden', 'true')
      toggle.append(symbol, label, chevron)
      const panel = el('div', 'hadley-drawer')
      panel.id = `hadley-drawer-${key}`
      panel.setAttribute('role', 'region')
      panel.setAttribute('aria-label', text)
      panel.hidden = true

      // in their order, whichever comes first: the files arrive from the server, the rewrite at once
      const next = ORDER.slice(ORDER.indexOf(key) + 1)
        .map((k) => made.get(k))
        .find(Boolean)
      if (next) {
        next.toggle.before(toggle)
        next.panel.before(panel)
      } else {
        toolbar.append(toggle)
        const last = [...made.values()].at(-1)?.panel ?? toolbar
        last.after(panel)
      }
      made.set(key, { toggle, label, panel })
      toggle.addEventListener('click', () => {
        const opening = toggle.getAttribute('aria-expanded') !== 'true'
        open(opening ? key : null)
        remember(opening ? key : '')
      })
      if (remembered() === key) open(key)
      return panel
    },
  }
}
