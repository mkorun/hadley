// The question before an open field with changes is closed by its × or Escape (field.ts; Michael, 2026-11-09): in the
// field, above its toolbar, not over the page. Keep editing has the focus; a second Escape keeps editing too.
import { el } from '../core/dom.ts'
import { T } from '../core/texts.ts'

/** Asks in `wrapper`, above `toolbar`; `discard` closes the field, keeping editing gives the field its focus back. */
export function askDiscard(wrapper: HTMLElement, toolbar: HTMLElement, discard: () => void, keep: () => void): void {
  const shown = wrapper.querySelector('.hadley-discard')
  if (shown) {
    // asked again while it stands: keep editing
    shown.remove()
    return keep()
  }
  const bar = el('div', 'hadley-discard')
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', T.discardAsk)
  const text = el('span')
  text.textContent = T.discardAsk
  const yes = el('button', 'hadley-discard-yes')
  yes.type = 'button'
  yes.textContent = T.discard
  const no = el('button', 'hadley-discard-no')
  no.type = 'button'
  no.textContent = T.keepEditing
  yes.addEventListener('click', discard)
  no.addEventListener('click', () => {
    bar.remove()
    keep()
  })
  bar.append(text, yes, no)
  toolbar.before(bar)
  no.focus()
}
