// The list of the card: the versions grouped by their day, newest first, each a row that opens in place (an
// accordion, one row open at a time), its detail (detail.ts) below it. A kept version shows a bookmark and its name.
import { el } from '../../core/dom.ts'
import { icon } from '../../core/icons.ts'
import { T } from '../../core/texts.ts'
import type { Version } from './api.ts'
import { day, time } from './when.ts'

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

/** What a row says of its version: who made it and what, or that it is the page as it is. */
export const said = (version: Version, isCurrent: boolean): string =>
  isCurrent ? T.current : [who(version), version.what ? WHAT[version.what] : ''].filter(Boolean).join(' · ')

/** The rows of `versions` under their days; `open` fills a row's detail when it opens (a closed one is emptied). */
export function rows(
  versions: readonly Version[],
  current: Version | undefined,
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
    what.textContent = said(version, version === current)
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
