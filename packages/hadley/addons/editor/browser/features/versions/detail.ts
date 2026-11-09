// A version opened in its row: what restoring it would change, line by line and word by word, and what can be done
// with it. Restoring is the main action and asks first (dialog.ts); keeping it under a name and deleting it happen in
// the row itself, deleting only after a question there. The page as it is can only be kept.
import { el } from '../../core/dom.ts'
import { icon } from '../../core/icons.ts'
import { T } from '../../core/texts.ts'
import { deleteVersion, keepVersion, restoreVersion, versionText, type Version } from './api.ts'
import { folded, lineDiff, marked, type MarkedLine } from './diff.ts'
import { moment } from '../../core/when.ts'

// unchanged lines on either side of a change; a longer run between two changes is folded
const CONTEXT = 3

export interface Context {
  path: string
  /** the hash of the page's file as it is */
  current: string
  isCurrent: boolean
  /** neither the newest nor the page as it is, which stay */
  deletable: boolean
  /** the question before restoring a version of `when` */
  confirm(when: string): Promise<boolean>
  /** holds the editor until the page reloads */
  lock(): void
  /** loads the list anew, with a message, and the version made at `open` opened again */
  reload(options?: { message?: string; open?: number }): Promise<void>
  say(message: string): void
}

const button = (className: string, text: string, symbol?: 'bookmark' | 'delete'): HTMLButtonElement => {
  const node = el('button', className)
  node.type = 'button'
  if (symbol) node.append(icon(symbol))
  node.append(Object.assign(el('span'), { textContent: text }))
  return node
}

/** Fills `detail` for `version`; nothing where the row closed meanwhile. */
export async function fill(detail: HTMLElement, version: Version, context: Context): Promise<void> {
  const turn = String(Math.random())
  detail.dataset['turn'] = turn
  const actions = el('div', 'hv-actions')
  if (context.isCurrent) {
    detail.replaceChildren(actions)
    actions.append(keepButton(detail, actions, version, context))
    return
  }
  const [then, now] = await Promise.all([
    versionText(context.path, version.hash),
    versionText(context.path, context.current),
  ])
  if (detail.dataset['turn'] !== turn || detail.hidden) return
  if (then === undefined || now === undefined) return context.reload({ message: T.changed })
  // what restoring it would change: from the page as it is to this version
  const lines = lineDiff(now, then)
  const diff = el('pre', 'hv-diff')
  if (lines === undefined) diff.textContent = T.tooLarge
  else diff.append(...folded(marked(lines), CONTEXT).map(line))

  const restore = button('hv-restore', T.restoreThis)
  restore.addEventListener('click', () => void restoreTo(version, restore, context))
  const remove = button('hv-delete', T.delete, 'delete')
  remove.addEventListener('click', () =>
    ask(detail, actions, T.deleteVersion, T.delete, async () => {
      const done = await deleteVersion(context.path, version)
      if (!done.ok) return context.say(done.error)
      await context.reload()
    }),
  )
  actions.append(restore, keepButton(detail, actions, version, context))
  if (context.deletable) actions.append(remove)
  detail.replaceChildren(diff, actions)
}

/** A line of the comparison: − out, + in, the words that changed marked; a folded run as its count. */
function line(part: MarkedLine | { kind: 'gap'; count: number }): HTMLElement {
  const row = el('span', `hv-${part.kind}`)
  if (part.kind === 'gap') {
    row.textContent = `⋯ ${part.count === 1 ? T.unchangedLine : T.unchangedLines.replace('{n}', String(part.count))}\n`
    return row
  }
  row.append(part.kind === 'add' ? '+ ' : part.kind === 'del' ? '− ' : '  ')
  if (!part.pieces) row.append(part.text)
  for (const piece of part.pieces ?? []) {
    if (!piece.changed) row.append(piece.text)
    else row.append(Object.assign(el(part.kind === 'add' ? 'ins' : 'del', 'hv-word'), { textContent: piece.text }))
  }
  row.append('\n')
  return row
}

/** "Keep…", or "Rename…" for a kept one: a name in the row, which keeps the version; without a name it is not kept. */
function keepButton(detail: HTMLElement, actions: HTMLElement, version: Version, context: Context): HTMLElement {
  const open = button('hv-keep', version.name ? T.rename : T.keepMore, 'bookmark')
  open.addEventListener('click', () => {
    const form = el('form', 'hv-form')
    const input = el('input')
    input.type = 'text'
    input.maxLength = 80
    input.placeholder = T.namePlaceholder
    input.setAttribute('aria-label', T.name)
    input.value = version.name ?? ''
    const keep = button('hv-confirm', T.keep, 'bookmark')
    keep.type = 'submit'
    const cancel = button('hv-cancel', T.cancel)
    const hint = el('p', 'hv-hint')
    hint.textContent = T.keepHint
    const buttons = el('div', 'hv-actions')
    buttons.append(keep, cancel)
    form.append(input, buttons, hint)
    const back = () => {
      form.remove()
      actions.hidden = false
      open.focus()
    }
    cancel.addEventListener('click', back)
    form.addEventListener('keydown', (event) => escape(event, back))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void (async () => {
        const done = await keepVersion(context.path, version, input.value)
        if (!done.ok) return context.say(done.error)
        await context.reload({ open: version.at })
      })()
    })
    actions.hidden = true
    detail.append(form)
    input.focus()
  })
  return open
}

/** A question in the row before something that cannot be undone; Cancel has the focus. */
export function ask(
  detail: HTMLElement,
  actions: HTMLElement,
  question: string,
  yes: string,
  then: () => Promise<void>,
): void {
  const box = el('div', 'hv-ask')
  box.setAttribute('role', 'group')
  const text = el('p')
  text.textContent = question
  const confirm = button('hv-danger', yes)
  const cancel = button('hv-cancel', T.cancel)
  const buttons = el('div', 'hv-actions')
  buttons.append(confirm, cancel)
  box.append(text, buttons)
  box.setAttribute('aria-label', question)
  const back = () => {
    box.remove()
    actions.hidden = false
  }
  cancel.addEventListener('click', back)
  box.addEventListener('keydown', (event) => escape(event, back))
  confirm.addEventListener('click', () => {
    confirm.disabled = true
    void then().finally(() => (confirm.disabled = false))
  })
  actions.hidden = true
  detail.append(box)
  cancel.focus()
}

/** Escape in a form or question of a row closes it, not the card. */
function escape(event: KeyboardEvent, back: () => void): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  back()
}

async function restoreTo(version: Version, restore: HTMLButtonElement, context: Context): Promise<void> {
  if (!(await context.confirm(moment(version.at)))) return
  restore.disabled = true
  const done = await restoreVersion(context.path, version, context.current)
  if (done.ok) return context.lock() // the page reloads once the dev server has built it anew, as after any change
  restore.disabled = false
  if (done.status === 409) return context.reload({ message: T.changed })
  context.say(done.error)
}
