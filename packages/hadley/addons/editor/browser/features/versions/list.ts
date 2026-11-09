// The list of the card: the versions grouped by their day, newest first, each a row that opens in place (an
// accordion, one row open at a time), its detail (detail.ts) below it. A kept version shows a bookmark and its name.
import { el } from '../../core/dom.ts'
import { icon } from '../../core/icons.ts'
import { T } from '../../core/texts.ts'
import type { Version } from './api.ts'
import { described } from '../../core/changes.ts'
import { day, moment, time } from '../../core/when.ts'

/** A restore names the version it brought back: its name, else when it was made; none where that one is gone. */
function restored(version: Version, all: readonly Version[]): string | undefined {
  if (version.by !== 'restore' || version.from === undefined) return undefined
  const source = all.find((v) => v.at === version.from)
  return source && T.restoredFrom(source.name ?? moment(source.at))
}

/** What a row says of its version: who made it and what, or that it is the page as it is, and where it came from. */
export function said(version: Version, isCurrent: boolean, away: boolean, all: readonly Version[] = []): string {
  const origin = restored(version, all)
  if (isCurrent) return origin ? `${T.current} · ${origin}` : T.current
  const what = origin ?? described(version)
  return away ? `${what} · ${T.undone}` : what
}

/** The rows of `versions` under their days; `open` fills a row's detail when it opens (a closed one is emptied). */
export function rows(
  versions: readonly Version[],
  current: Version | undefined,
  // the versions undo took the page away from (history.ts, undone)
  undone: ReadonlySet<number>,
  open: (version: Version, detail: HTMLElement) => void,
): HTMLElement[] {
  const out: HTMLElement[] = []
  let list: HTMLOListElement | undefined
  let lastDay = ''
  const items: { pick: HTMLButtonElement; detail: HTMLElement }[] = []

  const close = () => {
    for (const item of items) {
      item.pick.setAttribute('aria-expanded', 'false')
      item.detail.hidden = true
      item.detail.replaceChildren()
    }
  }

  versions.forEach((version, index) => {
    const label = day(version.at)
    if (!list || label !== lastDay) {
      const group = el('section', 'hv-day')
      const heading = el('h3')
      heading.textContent = label
      list = el('ol')
      group.append(heading, list)
      out.push(group)
      lastDay = label
    }
    const item = el('li', version.name ? 'hv-kept' : undefined)
    // the page as it is stands out; what undo took it away from steps back
    if (version === current) item.classList.add('hv-current')
    else if (undone.has(version.at)) item.classList.add('hv-undone')
    const pick = el('button', 'hv-item')
    pick.type = 'button'
    pick.dataset['at'] = String(version.at)
    pick.setAttribute('aria-expanded', 'false')
    const detail = el('div', 'hv-detail')
    detail.id = `hv-detail-${index}`
    detail.hidden = true
    pick.setAttribute('aria-controls', detail.id)
    const when = el('span', 'hv-when')
    when.textContent = time(version.at)
    const what = el('span', 'hv-who')
    what.textContent = said(version, version === current, undone.has(version.at), versions)
    pick.append(when, what)
    if (version.name) {
      const name = el('span', 'hv-name')
      name.append(icon('bookmark'), Object.assign(el('span'), { textContent: version.name }))
      pick.append(name)
    }
    pick.addEventListener('click', () => {
      const opening = pick.getAttribute('aria-expanded') !== 'true'
      close()
      if (!opening) return
      pick.setAttribute('aria-expanded', 'true')
      detail.hidden = false
      open(version, detail)
    })
    items.push({ pick, detail })
    item.append(pick, detail)
    list.append(item)
  })
  return out
}
