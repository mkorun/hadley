// The versions of the page, the time machine (addons/editor/history.ts): a button in the pill, in edit mode, opens a
// card above it with the page's versions, newest first. One chosen shows what differs from the page as it is, line by
// line, and can be restored, which the page then reloads with, or named. A name stays; of the unnamed, the last 100.
import { el } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { answer, post, serverError } from '../core/request.ts'
import { state } from '../core/state.ts'
import { LANG, T, withLang } from '../core/texts.ts'
import { lineDiff, type DiffLine } from './line-diff.ts'

interface Version {
  at: number
  hash: string
  by: 'editor' | 'agent' | 'outside' | 'restore'
  what?: 'edit' | 'move' | 'merge' | 'delete' | 'new' | 'picture'
  agent?: string
  name?: string
}

// unchanged lines on either side of a change; a longer run between two changes is folded
const CONTEXT = 3

const WHAT: Record<NonNullable<Version['what']>, string> = {
  edit: T.whatEdit,
  move: T.whatMove,
  merge: T.whatMerge,
  delete: T.whatDelete,
  new: T.whatNew,
  picture: T.whatPicture,
}

const who = (version: Version): string =>
  version.by === 'editor'
    ? T.byEditor
    : version.by === 'agent'
      ? T.byAgent.replace('{agent}', version.agent ?? 'AI')
      : version.by === 'restore'
        ? T.byRestore
        : T.byOutside

const when = (at: number): string =>
  new Date(at).toLocaleString(LANG, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export interface Versions {
  close(): void
}

/** The versions: `add` puts the button in the pill, `place` the card above it, `lock` holds the editor while the page
 * reloads. */
export function versions(on: {
  add(control: HTMLElement): void
  place(card: HTMLElement): void
  confirm(): Promise<boolean>
  lock(): void
}): Versions {
  const path = location.pathname
  const button = el('button', 'hadley-versions-toggle')
  button.type = 'button'
  button.setAttribute('aria-label', T.versionsTitle)
  button.title = T.versionsTitle
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', 'hadley-versions')
  button.append(icon('clock'), Object.assign(el('span'), { textContent: T.versions }))
  on.add(button)

  const card = el('section')
  card.id = 'hadley-versions'
  card.hidden = true
  card.setAttribute('aria-labelledby', 'hadley-versions-title')
  const header = el('header')
  const title = el('h2')
  title.id = 'hadley-versions-title'
  title.textContent = T.versionsTitle
  const close = el('button', 'hv-close')
  close.type = 'button'
  close.setAttribute('aria-label', T.closeVersions)
  close.title = T.closeVersions
  close.textContent = '×'
  header.append(title, close)
  const note = el('p', 'hv-note')
  note.textContent = T.kept
  const status = el('p', 'hv-status')
  status.setAttribute('role', 'status')
  const list = el('ol', 'hv-list')
  const detail = el('div', 'hv-detail')
  card.append(header, note, status, list, detail)
  on.place(card)

  let current = ''
  let shown: Version[] = []
  let chosen: string | undefined

  async function load(message = ''): Promise<void> {
    status.textContent = message
    detail.replaceChildren()
    chosen = undefined
    let data: Record<string, unknown>
    try {
      const res = await fetch(withLang(`/__hadley/history?path=${encodeURIComponent(path)}`), { cache: 'no-store' })
      data = await answer(res)
      if (!res.ok) {
        status.textContent = serverError(data)
        list.replaceChildren()
        return
      }
    } catch {
      status.textContent = T.connectionFailedDev
      return
    }
    current = typeof data['current'] === 'string' ? data['current'] : ''
    shown = Array.isArray(data['versions']) ? (data['versions'] as Version[]) : []
    list.replaceChildren(
      ...shown.map((version) => {
        const item = el('li')
        const pick = el('button', 'hv-item')
        pick.type = 'button'
        const isCurrent = version.hash === current && version === shown.find((v) => v.hash === current)
        pick.dataset['hash'] = version.hash
        pick.setAttribute('aria-pressed', 'false')
        const line = el('span', 'hv-when')
        line.textContent = when(version.at)
        const by = el('span', 'hv-who')
        by.textContent = isCurrent
          ? T.current
          : [who(version), version.what ? WHAT[version.what] : ''].filter(Boolean).join(' · ')
        pick.append(line, by)
        if (version.name) {
          const name = el('span', 'hv-name')
          name.textContent = version.name
          pick.append(name)
        }
        pick.addEventListener('click', () => void choose(version, pick))
        item.append(pick)
        return item
      }),
    )
    if (shown.length <= 1) {
      const none = el('li', 'hv-none')
      none.textContent = T.none
      list.append(none)
    }
  }

  async function text(hash: string): Promise<string | undefined> {
    const url = `/__hadley/history/version?path=${encodeURIComponent(path)}&hash=${hash}`
    const res = await fetch(withLang(url), { cache: 'no-store' }).catch(() => undefined)
    if (!res?.ok) return undefined
    const data = await answer(res)
    return typeof data['text'] === 'string' ? data['text'] : undefined
  }

  async function choose(version: Version, pick: HTMLElement): Promise<void> {
    chosen = version.hash
    for (const item of list.querySelectorAll('.hv-item')) item.setAttribute('aria-pressed', String(item === pick))
    detail.replaceChildren()
    const [then, now] = await Promise.all([text(version.hash), text(current)])
    if (chosen !== version.hash) return
    if (then === undefined || now === undefined) {
      await load(T.changed)
      return
    }
    // what restoring it would change: from the page as it is to this version
    const lines = lineDiff(now, then)
    const diff = el('pre', 'hv-diff')
    if (lines === undefined) diff.textContent = T.tooLarge
    else diff.append(...folded(lines))
    detail.append(diff, actions(version))
  }

  /** The lines of a comparison, unchanged runs folded down to CONTEXT lines on each side of a change. */
  function folded(lines: DiffLine[]): HTMLElement[] {
    const near = lines.map((_, i) =>
      lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((line) => line.kind !== 'same'),
    )
    const out: HTMLElement[] = []
    let folded = 0
    const fold = () => {
      if (folded === 0) return
      const gap = el('span', 'hv-gap')
      gap.textContent = `⋯ ${folded}\n`
      out.push(gap)
      folded = 0
    }
    lines.forEach((line, i) => {
      if (!near[i]) {
        folded += 1
        return
      }
      fold()
      const row = el('span', `hv-${line.kind}`)
      row.textContent = `${line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '} ${line.text}\n`
      out.push(row)
    })
    fold()
    return out
  }

  function actions(version: Version): HTMLElement {
    const row = el('div', 'hv-actions')
    const isCurrent = version.hash === current
    if (!isCurrent) {
      const restore = el('button', 'hv-restore')
      restore.type = 'button'
      restore.textContent = T.restore
      restore.addEventListener('click', () => void restoreTo(version, restore))
      row.append(restore)
    }
    const name = el('button', 'hv-name-button')
    name.type = 'button'
    name.textContent = T.name
    const form = el('form', 'hv-name-form')
    form.hidden = true
    const input = el('input')
    input.type = 'text'
    input.maxLength = 80
    input.placeholder = T.namePlaceholder
    input.setAttribute('aria-label', T.name)
    input.value = version.name ?? ''
    form.append(input)
    name.addEventListener('click', () => {
      form.hidden = false
      input.focus()
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void (async () => {
        const res = await post('/__hadley/history/name', { path, hash: version.hash, name: input.value }).catch(
          () => undefined,
        )
        if (!res?.ok) status.textContent = res ? serverError(await answer(res)) : T.connectionFailedDev
        else await load()
      })()
    })
    row.append(name, form)
    return row
  }

  async function restoreTo(version: Version, button: HTMLButtonElement): Promise<void> {
    if (!(await on.confirm())) return
    button.disabled = true
    const res = await post('/__hadley/history/restore', { path, hash: version.hash, current }).catch(() => undefined)
    if (!res) {
      status.textContent = T.connectionFailedDev
      button.disabled = false
      return
    }
    if (res.status === 409) return load(T.changed)
    if (!res.ok) {
      status.textContent = serverError(await answer(res))
      button.disabled = false
      return
    }
    // the page reloads once the dev server has built it anew, as after any change
    on.lock()
  }

  function setOpen(open: boolean): void {
    card.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) void load()
  }
  button.addEventListener('click', () => setOpen(card.hidden !== false))
  close.addEventListener('click', () => setOpen(false))
  document.addEventListener('keydown', (event) => {
    // the field's Escape comes first (main.ts); without an open block, Escape closes the card
    if (event.key === 'Escape' && !card.hidden && !state.block) setOpen(false)
  })

  return { close: () => setOpen(false) }
}
