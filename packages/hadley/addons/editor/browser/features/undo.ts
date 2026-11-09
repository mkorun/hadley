// Undo and redo for the page (Michael, 2026-11-09): two buttons in the pill, in edit mode, and Ctrl+Z, Ctrl+Shift+Z or
// Ctrl+Y while no field is open. They step through the page's versions as an editor's stacks (addons/editor/history.ts,
// steps): the editor's changes, the agent's and those from outside alike, each button's title says which. After a
// block was deleted, moved or merged, a note above the pill offers to undo it, as Gmail does; a deletion asks nothing
// before. Each step is a change as any: the editor waits for the page (updating.ts).
import { described, WHAT, type Change } from '../core/changes.ts'
import { el } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { answer, post, serverError } from '../core/request.ts'
import { isEditMode, state } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'
import { time } from '../core/when.ts'

type Way = 'undo' | 'redo'

// how long the note after a deletion, move or merge offers to undo it
const OFFER = 8000

export interface Undo {
  /** the buttons as the page's versions stand now: after each change of the page */
  refresh(): Promise<void>
  /** after a block was deleted, moved or merged: the note offers to undo it, once the page shows it */
  offer(what: NonNullable<Change['what']>): void
}

export function undo(on: {
  add(control: HTMLElement): void
  note(text: string | null, action?: { label: string; run(): void }): void
  /** the editor waits for the page, as after any change */
  wait(): void
}): Undo {
  const path = location.pathname
  const button = (way: Way) => {
    const node = el('button', 'hadley-undo')
    node.type = 'button'
    node.dataset['way'] = way
    node.setAttribute('aria-label', way === 'undo' ? T.undo : T.redo)
    node.append(icon(way))
    node.addEventListener('click', () => void go(way))
    on.add(node)
    return node
  }
  const buttons = { undo: button('undo'), redo: button('redo') }
  let current = ''
  let offered: NonNullable<Change['what']> | undefined
  let offerTimer: ReturnType<typeof setTimeout> | undefined

  const show = (way: Way, change: Change | undefined) => {
    const node = buttons[way]
    node.disabled = !change
    node.title = change
      ? (way === 'undo' ? T.undoTitle : T.redoTitle)(`${described(change)}, ${time(change.at)}`)
      : way === 'undo'
        ? T.nothingToUndo
        : T.nothingToRedo
  }

  async function refresh(): Promise<void> {
    let data: Record<string, unknown> = {}
    try {
      const res = await fetch(withLang(`/__hadley/history/steps?path=${encodeURIComponent(path)}`), {
        cache: 'no-store',
      })
      if (res.ok) data = await answer(res)
    } catch {
      // without an answer both stay off
    }
    current = typeof data['current'] === 'string' ? data['current'] : ''
    show('undo', data['undo'] as Change | undefined)
    show('redo', data['redo'] as Change | undefined)
    if (!offered) return
    const what = offered
    offered = undefined
    clearTimeout(offerTimer)
    if (buttons.undo.disabled) return
    on.note(WHAT[what], { label: T.undo, run: () => void go('undo') })
    offerTimer = setTimeout(() => on.note(null), OFFER)
  }

  async function go(way: Way): Promise<void> {
    if (!isEditMode() || state.block || state.locked || buttons[way].disabled || !current) return
    clearTimeout(offerTimer)
    on.note(null)
    let res: Response
    try {
      res = await post('/__hadley/history/step', { path, way, current })
    } catch {
      return on.note(T.connectionFailedDev)
    }
    if (res.ok) return on.wait()
    // the page changed since the buttons were shown: they are shown anew
    if (res.status === 409) on.note(T.pageChanged)
    else on.note(serverError(await answer(res)))
    await refresh()
  }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !isEditMode() || state.block) return
    // a field of the page or of the chat keeps its own undo
    const target = e.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
    const key = e.key.toLowerCase()
    const way: Way | undefined = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : undefined
    if (!way) return
    e.preventDefault()
    void go(way)
  })

  return {
    refresh,
    offer(what) {
      offered = what
    },
  }
}
