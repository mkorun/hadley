// In edit mode a link in a block or in a page's head does not lead away on a plain click, so that a double click can
// open its block (Michael, 2026-11-09), as in Google Docs and Notion; Ctrl or Cmd click, Shift click and the middle
// button open it as ever. Out of edit mode a link is a link.
import { isEditMode } from '../core/state.ts'

export function holdLinks(): void {
  document.addEventListener(
    'click',
    (e) => {
      if (!isEditMode() || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (link?.closest('[data-hadley-id], [data-hadley-head-editable]')) e.preventDefault()
    },
    // before a theme's own handlers, which might follow the link themselves
    true,
  )
}
