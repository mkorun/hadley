// What the features share: the open field, the lock after a change, and edit mode, which the body's class holds.
import { T } from './texts.ts'

export const state: {
  /** the block of the open field */
  block: string | null
  /** the open field's .hadley-editor */
  wrapper: HTMLElement | null
  textarea: HTMLTextAreaElement | null
  /** a new block below: the text of the block it follows, saved with it (field.ts, open's `after`) */
  after: string | null
  /** ADR-14: after a change of the editor's, until the page is up to date (features/updating.ts) */
  locked: boolean
} = { block: null, wrapper: null, textarea: null, after: null, locked: false }

export const isEditMode = (): boolean => document.body.classList.contains('hadley-edit-mode')

/** A reload after an action must not jump to the anchor the page was opened with. */
export function clearHash(): void {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
}

/** For failures outside a request (an animation, a dialog, the history API): log the cause and tell the user. */
export function failAction(error: unknown): void {
  console.error(error)
  alert(`${T.unknownError}: ${error instanceof Error ? error.message : String(error)}`)
}
