// The page's head: its title and subtitle, edited where the theme shows them.
//
// hadley takes the title and subtitle out of the text, and the theme shows them where it likes; in a dev build it marks
// them, data-hadley-head="title" and "subtitle" (docs/themes.md). The dev server names the block that edits each, its
// line of Markdown or the front matter that gives it; a right click opens it as any block, without a block menu.
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

/** The heads made editable; `edit` opens a block's field, `badge` places the front matter's badge. */
export async function attachHeads(on: {
  edit(blockId: string, el: HTMLElement, options?: OpenOptions): void
  badge(badge: HTMLElement): void
}): Promise<void> {
  let heads: { title?: Head; subtitle?: Head; frontMatter?: Head } | undefined
  try {
    const res = await fetch(withLang(`/__hadley/heads?path=${encodeURIComponent(location.pathname)}`))
    if (!res.ok) return
    heads = (await res.json()) as typeof heads
  } catch {
    return
  }
  const free = () => isEditMode() && !state.block && !state.locked
  for (const which of ['title', 'subtitle'] as const) {
    const head = heads?.[which]
    const id = head?.id
    if (!head || typeof id !== 'string') continue
    const element = document.querySelector<HTMLElement>(HEAD[which])
    if (!element) continue
    element.dataset['hadleyHeadEditable'] = ''
    // the front matter, where it gives the title or subtitle, is Lima, not text to rewrite (addons/chat)
    if (head.from === 'front matter') element.dataset['hadleyFrontMatter'] = ''
    element.addEventListener('contextmenu', (e) => {
      if (!free()) return
      e.preventDefault()
      e.stopPropagation()
      on.edit(id, element)
    })
  }
  // the front matter, from a badge right above the title, shown in edit mode only
  const title = document.querySelector(HEAD.title)
  const frontMatterId = heads?.frontMatter?.id
  if (typeof frontMatterId === 'string' && title) {
    const badge = el('button', 'hadley-front-matter-badge')
    badge.type = 'button'
    badge.append(icon('data'))
    badge.append(Object.assign(el('span'), { textContent: T.frontMatter }))
    badge.setAttribute('aria-label', T.frontMatter)
    badge.title = T.frontMatter
    badge.dataset['hadleyFrontMatter'] = ''
    badge.addEventListener('click', () => {
      if (!free()) return
      // the badge sits over the page: the field opens in it, above the title
      on.edit(frontMatterId, badge, { place: (wrapper) => title.before(wrapper) })
    })
    // beside the frames' layer, placed with it, not before the title: the page does not move when edit mode turns on;
    // not in that layer, which is hidden from assistive technology
    on.badge(badge)
    document.body.append(badge)
  }
}
