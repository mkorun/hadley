// A question before what cannot be taken back as easily, a block deleted or a version restored: a dialog over the page,
// Cancel focused, Escape or a click beside it cancels.
import { el, svg } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { T } from '../core/texts.ts'

export const confirmDelete = (): Promise<boolean> =>
  ask({ title: T.deleteDialogTitle, body: T.deleteDialogBody, confirm: T.confirmDelete })

/** The question before a version of the page, of `when`, takes its place (features/versions/). */
export const confirmRestore = (when: string): Promise<boolean> =>
  ask({ title: T.restoreTitle, body: T.restoreBody(when), confirm: T.restore, symbol: 'clock', calm: true })

// calm: nothing is lost by it (going back keeps the page as it is), so the accent, not the red of deleting
function ask(texts: {
  title: string
  body: string
  confirm: string
  symbol?: 'clock'
  calm?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div')
    overlay.id = 'hadley-delete-overlay'
    const dialog = el('div')
    dialog.id = 'hadley-delete-dialog'
    if (texts.calm) dialog.classList.add('is-calm')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'hadley-delete-title')
    const symbol = el('div', 'hdd-icon')
    symbol.setAttribute('aria-hidden', 'true')
    symbol.append(
      texts.symbol
        ? icon(texts.symbol)
        : svg(
            {
              viewBox: '0 0 20 20',
              width: '20',
              height: '20',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '1.6',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            },
            [
              ['line', { x1: '3', y1: '5', x2: '17', y2: '5' }],
              ['path', { d: 'M7 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1' }],
              ['path', { d: 'M4.5 5l1 11a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-11' }],
            ],
          ),
    )
    const title = el('p', 'hdd-title')
    title.id = 'hadley-delete-title'
    title.textContent = texts.title
    const body = el('p', 'hdd-body')
    body.textContent = texts.body
    const actions = el('div', 'hdd-actions')
    const cancel = el('button', 'hdd-cancel')
    cancel.textContent = T.cancel
    const confirm = el('button', 'hdd-confirm')
    confirm.textContent = texts.confirm
    actions.append(cancel, confirm)
    dialog.append(symbol, title, body, actions)
    overlay.append(dialog)

    const done = (result: boolean) => {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        done(false)
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false)
    })
    cancel.addEventListener('click', () => done(false))
    confirm.addEventListener('click', () => done(true))
    document.addEventListener('keydown', onKey)

    document.body.appendChild(overlay)
    cancel.focus()
  })
}
