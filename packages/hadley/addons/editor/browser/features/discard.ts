// The question before an open field with changes is closed by Cancel or Escape (field.ts; Michael, 2026-11-09): in
// the field, above its toolbar, not over the page (core/ask.ts). Keep editing has the focus; a second Escape, wherever
// the focus is, keeps editing too.
import { askInPlace } from '../core/ask.ts'
import { T } from '../core/texts.ts'

/** Asks in `wrapper`, above `toolbar`; `discard` closes the field, keeping editing gives the field its focus back. */
export function askDiscard(wrapper: HTMLElement, toolbar: HTMLElement, discard: () => void, keep: () => void): void {
  const shown = wrapper.querySelector('.hadley-discard')
  if (shown) {
    // asked again while it stands: keep editing
    shown.remove()
    return keep()
  }
  askInPlace({
    place: (question) => toolbar.before(question),
    question: T.discardAsk,
    yes: T.discard,
    no: T.keepEditing,
    className: 'hadley-discard',
    then: discard,
    back: keep,
  })
}
