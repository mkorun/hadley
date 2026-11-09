// A question in place, before what loses something (Michael, 2026-11-09: four of them were four copies): in the field,
// a row or the foot of the versions card, the files' drawer; never a dialog over the page. The safe answer has the
// focus, and Escape gives it, inside the question, without closing what holds it. An error of Yes shows in the
// question, and Yes may be asked again.
import { el } from './dom.ts'

export interface Asked {
  /** where the question goes in: before, after or into a node of the caller's */
  place(question: HTMLElement): void
  question: string
  yes: string
  no: string
  /** its look: the question's class, and `<class>-text`, `-yes`, `-no`, `-message` on its parts */
  className: string
  /** after Yes: an error to show in the question, else nothing (what holds the question then changes or goes) */
  then(): void | string | Promise<void | string>
  /** after No or Escape, the question gone */
  back?(): void
}

/** Puts the question in place, the focus on No; the question, for its caller to take away. */
export function askInPlace(asked: Asked): HTMLElement {
  const bar = el('div', asked.className)
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', asked.question)
  const text = el('span', `${asked.className}-text`)
  text.textContent = asked.question
  const yes = el('button', `${asked.className}-yes`)
  yes.type = 'button'
  yes.textContent = asked.yes
  const no = el('button', `${asked.className}-no`)
  no.type = 'button'
  no.textContent = asked.no
  const message = el('span', `${asked.className}-message`)
  message.setAttribute('role', 'status')
  message.hidden = true

  const back = () => {
    bar.remove()
    asked.back?.()
  }
  no.addEventListener('click', back)
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    // the question, not the field or the card that holds it
    event.stopPropagation()
    back()
  })
  // the question itself holds the focus while Yes waits: Escape stays its own
  bar.tabIndex = -1
  yes.addEventListener('click', () => {
    bar.focus()
    yes.disabled = true
    void Promise.resolve(asked.then()).then((error) => {
      if (typeof error !== 'string') return
      message.textContent = error
      message.hidden = false
      yes.disabled = false
      // Yes, off while it waited, lost the focus: back to the safe answer, so that Escape stays the question's
      no.focus()
    })
  })
  bar.append(text, yes, no, message)
  asked.place(bar)
  no.focus()
  return bar
}
