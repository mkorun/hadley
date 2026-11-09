// The versions of the page, the time machine (addons/editor/history.ts): a button in the pill, in edit mode, opens a
// card above it with the page's versions by day, newest first (list.ts). A version opens in its row (detail.ts). At
// the foot: how many there are, and deleting every unnamed one; the limit of 100 only once it comes near. One card
// above the pill at a time: opening it closes the chat's, and the chat's closes it (`hadley:card-open`, addons/chat).
import { el } from '../../core/dom.ts'
import { icon } from '../../core/icons.ts'
import { state } from '../../core/state.ts'
import { T } from '../../core/texts.ts'
import { deleteUnnamed, listVersions, type Version } from './api.ts'
import { ask, fill } from './detail.ts'
import { rows } from './list.ts'

// the unnamed versions a page keeps (history.ts, KEEP), and from how many on the foot says so
const KEEP = 100
const NEAR = 90

export interface Versions {
  close(): void
}

/** The versions: `add` puts the button in the pill, `place` the card above it, `confirm` asks before restoring a
 * version of `when`, `lock` holds the editor while the page reloads. */
export function versions(on: {
  add(control: HTMLElement): void
  place(card: HTMLElement): void
  confirm(when: string): Promise<boolean>
  lock(): void
}): Versions {
  const path = location.pathname
  const toggle = el('button', 'hadley-versions-toggle')
  toggle.type = 'button'
  toggle.setAttribute('aria-label', T.versionsTitle)
  toggle.title = T.versionsTitle
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', 'hadley-versions')
  toggle.append(icon('clock'), Object.assign(el('span'), { textContent: T.versions }))
  on.add(toggle)

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
  const status = el('p', 'hv-status')
  status.setAttribute('role', 'status')
  const list = el('div', 'hv-list')
  const foot = el('footer', 'hv-foot')
  card.append(header, status, list, foot)
  on.place(card)

  async function load(options: { message?: string; open?: number } = {}): Promise<void> {
    status.textContent = options.message ?? ''
    const got = await listVersions(path)
    if (!got.ok) {
      status.textContent = got.error
      list.replaceChildren()
      foot.replaceChildren()
      return
    }
    const { current, versions: shown } = got.value
    const now = shown[0]?.hash === current ? shown[0] : undefined
    list.replaceChildren(
      ...rows(
        shown,
        now,
        (version, detail) =>
          void fill(detail, version, {
            path,
            current,
            isCurrent: version === now,
            confirm: on.confirm,
            lock: on.lock,
            reload: load,
            say: (message) => (status.textContent = message),
          }),
      ),
    )
    if (shown.length <= 1) {
      const none = el('p', 'hv-none')
      none.textContent = T.none
      list.append(none)
    }
    footer(shown)
    const again = options.open === undefined ? undefined : String(options.open)
    for (const item of list.querySelectorAll<HTMLButtonElement>('.hv-item'))
      if (item.dataset['at'] === again) item.click()
  }

  /** The count, deleting every unnamed version but the newest, and the limit once it comes near. */
  function footer(shown: readonly Version[]): void {
    const unnamed = shown.slice(1).filter((version) => !version.name).length
    const line = el('div', 'hv-foot-line')
    const count = el('span')
    count.textContent = T.versionCount(shown.length)
    line.append(count)
    if (unnamed > 0) {
      const all = el('button', 'hv-delete-unnamed')
      all.type = 'button'
      all.textContent = T.deleteUnnamed
      all.addEventListener('click', () =>
        ask(foot, line, T.deleteUnnamedAsk(unnamed), T.deleteCount(unnamed), async () => {
          const done = await deleteUnnamed(path)
          if (!done.ok) return void (status.textContent = done.error)
          await load()
        }),
      )
      line.append(all)
    }
    foot.replaceChildren(line)
    if (unnamed + 1 >= NEAR && unnamed <= KEEP) {
      const limit = el('p', 'hv-limit')
      limit.textContent = T.limit
      foot.append(limit)
    }
  }

  function setOpen(open: boolean): void {
    card.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    if (!open) return
    // one card above the pill at a time: the versions' or the chat's (Michael, 2026-11-09)
    document.dispatchEvent(new CustomEvent('hadley:card-open', { detail: { id: card.id } }))
    void load()
  }
  document.addEventListener('hadley:card-open', (event) => {
    if (!card.hidden && (event as CustomEvent<{ id?: string }>).detail?.id !== card.id) setOpen(false)
  })
  toggle.addEventListener('click', () => setOpen(card.hidden !== false))
  close.addEventListener('click', () => setOpen(false))
  document.addEventListener('keydown', (event) => {
    // the field's Escape comes first (main.ts); without an open block, Escape closes the card
    if (event.key === 'Escape' && !card.hidden && !state.block) setOpen(false)
  })

  return { close: () => setOpen(false) }
}
