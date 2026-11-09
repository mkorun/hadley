// The editor while the page is brought up to date (../refresh/): after a change of its own it is locked (ADR-14) until
// the page is, the changed block dimmed; a change from outside waits while a field is open; a rebuild that fails frees
// it and says so; nothing for WAIT ms reloads the page. Reading, scrolling, the chat and the cards stay free.
import { state } from '../core/state.ts'
import { T } from '../core/texts.ts'

const WAIT = 15_000

export interface Updating {
  /** after a change of the editor's: locked until the page is up to date; `block` dimmed meanwhile */
  wait(block?: Element | null): void
}

export function updating(on: {
  lock(): void
  unlock(): void
  note(text: string | null): void
  /** the page changed in place: what hangs on its blocks, anew */
  refreshed(): void
}): Updating {
  let waiting = false
  let held = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let dimmed: Element | null = null

  const done = () => {
    clearTimeout(timer)
    dimmed?.classList.remove('hadley-pending')
    dimmed = null
    if (!waiting) return
    waiting = false
    on.unlock()
  }

  // a change from outside while a field is open: after the field, not under it
  document.addEventListener('hadley:refresh', (event) => {
    if (!state.block) return
    event.preventDefault()
    held = true
    on.note(T.waitingForField)
  })
  document.addEventListener('hadley:editor-close', () => {
    if (!held) return
    held = false
    on.note(null)
    // after the field's own close, which this event comes from
    queueMicrotask(() => document.dispatchEvent(new CustomEvent('hadley:refresh-release')))
  })
  document.addEventListener('hadley:refreshed', () => {
    on.note(null)
    done()
    on.refreshed()
  })
  document.addEventListener('hadley:build-failed', () => {
    done()
    on.note(T.buildFailed)
  })

  return {
    wait(block) {
      waiting = true
      on.note(null)
      on.lock()
      dimmed = block ?? null
      dimmed?.classList.add('hadley-pending')
      clearTimeout(timer)
      timer = setTimeout(() => location.reload(), WAIT)
    },
  }
}
