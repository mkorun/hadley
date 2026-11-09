// The page's head: its title and subtitle, edited where the theme shows them.
//
// hadley takes the title and subtitle out of the text, and the theme shows them where it likes; in a dev build it marks
// them, data-hadley-head="title" and "subtitle" (docs/themes.md). The dev server names the block that edits each, its
// line of Markdown or the front matter that gives it; a right click opens it as any block, without a block menu.
import { clickedWord } from '../core/caret.ts'
import { el } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { state, isEditMode } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'
import type { OpenOptions } from './field.ts'

const HEAD = { title: '[data-hadley-head="title"]', subtitle: '[data-hadley-head="subtitle"]' }

interface Head {
  id?: unknown
  from?: unknown
}

export interface Heads {
  /** the heads as the dev server names them now: their blocks' ids change with every change of the file */
  refresh(): Promise<void>
}

/** The heads made editable; `edit` opens a block's field, `badge` places the front matter's badge. */
export function heads(on: {
  edit(blockId: string, el: HTMLElement, options?: OpenOptions): void
  badge(badge: HTMLElement): void
}): Heads {
  const ids: { title?: string; subtitle?: string; frontMatter?: string } = {}
  // an element is bound once; one the page brought anew (../refresh/) is bound at the next refresh
  const bound = new WeakSet<Element>()
  let badge: HTMLButtonElement | undefined
  const free = () => isEditMode() && !state.block && !state.locked

  async function refresh(): Promise<void> {
    let heads: { title?: Head; subtitle?: Head; frontMatter?: Head } | undefined
    try {
      const res = await fetch(withLang(`/__hadley/heads?path=${encodeURIComponent(location.pathname)}`))
      if (!res.ok) return
      heads = (await res.json()) as typeof heads
    } catch {
      return
    }
    for (const which of ['title', 'subtitle'] as const) {
      const head = heads?.[which]
      const id = head?.id
      if (!head || typeof id !== 'string') {
        delete ids[which]
        continue
      }
      ids[which] = id
      const element = document.querySelector<HTMLElement>(HEAD[which])
      if (!element) continue
      element.dataset['hadleyHeadEditable'] = ''
      // the front matter, where it gives the title or subtitle, is Lima, not text to rewrite (addons/chat)
      if (head.from === 'front matter') element.dataset['hadleyFrontMatter'] = ''
      else delete element.dataset['hadleyFrontMatter']
      if (bound.has(element)) continue
      bound.add(element)
      element.addEventListener('contextmenu', (e) => {
        const now = ids[which]
        if (!free() || now === undefined) return
        e.preventDefault()
        e.stopPropagation()
        on.edit(now, element)
      })
      // a double click, as on a block, the cursor on the word clicked
      element.addEventListener('dblclick', (e) => {
        const now = ids[which]
        if (!free() || now === undefined) return
        e.preventDefault()
        on.edit(now, element, { word: clickedWord(element, e) })
      })
    }
    // the front matter, from a badge right above the title, shown in edit mode only
    const frontMatterId = heads?.frontMatter?.id
    if (typeof frontMatterId === 'string') ids.frontMatter = frontMatterId
    else delete ids.frontMatter
    if (badge || ids.frontMatter === undefined || !document.querySelector(HEAD.title)) return
    badge = el('button', 'hadley-front-matter-badge')
    badge.type = 'button'
    badge.append(icon('data'))
    badge.append(Object.assign(el('span'), { textContent: T.frontMatter }))
    badge.setAttribute('aria-label', T.frontMatter)
    badge.title = T.frontMatter
    badge.dataset['hadleyFrontMatter'] = ''
    const own = badge
    own.addEventListener('click', () => {
      const id = ids.frontMatter
      const title = document.querySelector(HEAD.title)
      if (!free() || id === undefined || !title) return
      // the badge sits over the page: the field opens in it, above the title
      on.edit(id, own, { place: (wrapper) => title.before(wrapper) })
    })
    // beside the frames' layer, placed with it, not before the title: the page does not move when edit mode turns on;
    // not in that layer, which is hidden from assistive technology
    on.badge(own)
    document.body.append(own)
  }

  return { refresh }
}
