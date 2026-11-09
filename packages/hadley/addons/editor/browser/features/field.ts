// The field a block is edited in: loaded from the server (plugin.ts), in the page's flow after the block (ADR-10), and
// saved back to the page's file, after which the page is brought up to date (ADR-3, ../refresh/). Save is on only
// where the text changed (Michael, 2026-11-09). Ctrl+Enter or Ctrl+S
// (Cmd on a Mac) saves it, Escape (main.ts) closes it; Enter is a new line, which Markdown blocks need (lists, tables,
// code). The chat (addons/chat) hears of it by `hadley:editor-open` and
// `hadley:editor-close`.
import { wordIn, type Clicked } from '../core/word.ts'
import { el, fitTextarea } from '../core/dom.ts'
import { askDiscard } from './discard.ts'
import { drawers, type Drawers } from './drawers.ts'
import { answer, post, serverError } from '../core/request.ts'
import { state, clearHash, failAction } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'

export interface OpenOptions {
  /** a new block below the one given */
  below?: boolean
  /** where the field goes, else right after the block */
  place?: ((wrapper: HTMLElement) => void) | undefined
  /** the word a double click opened it on: the cursor in it where the pointer was, else at the end */
  word?: Clicked | undefined
}

export interface Field {
  open(blockId: string, blockEl: HTMLElement, options?: OpenOptions): Promise<void>
  close(): void
  /** Cancel or Escape: closes it, after a question where its text changed (discard.ts) */
  cancel(): void
}

/** What a field shows beside its text: the front matter's table, the bundle's files, and pictures added to it. */
export interface Parts {
  closeMenu(): void
  /** saved: the block that changed (none for a new one), until the page shows it anew */
  saved(block: HTMLElement | null): void
  table(textarea: HTMLTextAreaElement): HTMLElement
  /** the bundle's files, in their drawer (drawers.ts) */
  files(blockId: string, textarea: HTMLTextAreaElement, drawers: Drawers): void
  pictures(blockId: string, textarea: HTMLTextAreaElement, toolbar: HTMLElement, drawers: Drawers): void
}

// On 422, plugin.ts also sends `errors` (Diagnostic.range, markanto-js ≥0.1.1), each with `local`: does the error
// overlap the block being edited? plugin.ts refuses an edit only for a `local` error; an integrity check makes sure
// no other block changed meaning. The message tells "you broke this" apart from "the error already exists elsewhere
// in the document". Without `errors` (an older server, or a refusal by the integrity check) it falls back to the
// old message that makes no such distinction.
function buildParseErrorMessage(data: Record<string, unknown>): string {
  const errors = Array.isArray(data['errors']) ? (data['errors'] as { local?: unknown; message?: unknown }[]) : null
  if (!errors || errors.length === 0) return T.parseError(typeof data['error'] === 'string' ? data['error'] : '')

  const local = errors.filter((e) => e.local).map((e) => e.message)
  const elsewhere = errors.filter((e) => !e.local).map((e) => e.message)

  const parts = []
  if (local.length) parts.push(T.parseError(local.join('; ')))
  if (elsewhere.length) parts.push(T.parseErrorElsewhere(elsewhere.join('; ')))
  return parts.join('\n\n')
}

export function field(parts: Parts): Field {
  // the open field's text as it opened, and where the question before discarding goes
  let opened: { text: string; toolbar: HTMLElement; showSave(): void } | null = null

  function cancel() {
    const wrapper = state.wrapper
    const textarea = state.textarea
    if (!wrapper || !textarea || !opened) return
    if (textarea.value === opened.text) return close()
    askDiscard(wrapper, opened.toolbar, close, () => textarea.focus())
  }

  function close() {
    opened = null
    document.dispatchEvent(new CustomEvent('hadley:editor-close'))
    state.wrapper?.remove()
    state.wrapper = null
    state.textarea = null
    state.block = null
    state.after = null
    document.body.classList.remove('hadley-editing')
  }

  function openEditor(
    blockId: string,
    blockEl: HTMLElement,
    text: string,
    { after = null, place, word }: Pick<OpenOptions, 'place' | 'word'> & { after?: string | null } = {},
  ) {
    state.block = blockId
    state.after = after
    document.body.classList.add('hadley-editing')

    const wrapper = el('div', 'hadley-editor')

    const textarea = el('textarea', 'hadley-textarea')
    textarea.value = text
    textarea.setAttribute('aria-label', T.editAriaLabel)
    textarea.setAttribute('spellcheck', 'true')

    const editorToolbar = el('div', 'hadley-editor-toolbar')

    const saveBtn = el('button', 'hadley-save-btn')
    saveBtn.type = 'button'
    saveBtn.textContent = T.save

    // Cancel as a word beside Save, as GitHub and Google Docs edit in place (Michael, 2026-11-09: a × said too little)
    const cancelBtn = el('button', 'hadley-cancel-btn')
    cancelBtn.type = 'button'
    cancelBtn.textContent = T.cancel
    cancelBtn.title = T.escToCancel

    editorToolbar.append(saveBtn, cancelBtn)
    // the seldom needed tools at the toolbar's right, folded away under it
    const tools = drawers(editorToolbar)
    const frontMatter = blockEl.dataset['hadleyFrontMatter'] !== undefined
    wrapper.append(frontMatter ? parts.table(textarea) : textarea, editorToolbar)
    // after the block, or where the caller puts it (the front matter's badge)
    if (place) place(wrapper)
    else blockEl.insertAdjacentElement('afterend', wrapper)
    if (!frontMatter) {
      parts.files(blockId, textarea, tools)
      parts.pictures(blockId, textarea, editorToolbar, tools)
    }

    state.wrapper = wrapper
    state.textarea = textarea

    textarea.focus()
    // a double click: the cursor where the pointer was, in the word clicked; else at the end
    const at = word ? wordIn(textarea.value, word) : -1
    const caret = word && at !== -1 ? at + (word.inner ?? 0) : textarea.value.length
    textarea.setSelectionRange(caret, caret)

    // Save only where there is something to save, and its title says why not
    const unchanged = () => textarea.value === text
    const showSave = () => {
      saveBtn.disabled = unchanged()
      saveBtn.title = unchanged() ? T.noChanges : T.saveShortcut
    }
    showSave()
    textarea.addEventListener('input', () => {
      fitTextarea(textarea)
      showSave()
    })
    fitTextarea(textarea)

    saveBtn.addEventListener('click', () => void save(blockId, blockEl, saveBtn))
    opened = { text: textarea.value, toolbar: editorToolbar, showSave }
    cancelBtn.addEventListener('click', cancel)
    document.dispatchEvent(
      new CustomEvent('hadley:editor-open', {
        detail: {
          block: blockId,
          // the front matter is Lima, which the chat does not rewrite
          frontMatter,
          textarea,
          wrapper,
          // a drawer of the field's for the chat's rewrite (drawers.ts), and opening it
          drawer: tools.drawer,
          openDrawer: tools.open,
          insert(start: number, end: number, replacement: string) {
            if (state.textarea !== textarea) return false
            textarea.focus()
            textarea.setSelectionRange(start, end)
            // insertText participates in the browser's native undo history; assigning value does not.
            const inserted = document.execCommand('insertText', false, replacement)
            // what came in stays selected, so that it shows, and the next action rewrites it again
            if (inserted) textarea.setSelectionRange(start, start + replacement.length)
            fitTextarea(textarea)
            return inserted
          },
        },
      }),
    )
  }

  async function open(blockId: string, blockEl: HTMLElement, { below = false, place, word }: OpenOptions = {}) {
    if (state.block) return
    parts.closeMenu()

    let text: string
    try {
      const res = await fetch(withLang(`/__hadley/block/${blockId}`))
      if (!res.ok) {
        // 409: the file changed since the page was rendered, and its blocks moved
        if (res.status === 404 || res.status === 409) {
          alert(T.blockGoneReload)
          clearHash()
          location.reload()
          return
        }
        alert(T.loadBlockError(res.status))
        return
      }
      const data = (await res.json()) as { text: string }
      text = data.text
    } catch {
      alert(T.connectionFailedDev)
      return
    }

    try {
      // a new block below is an edit of the block above: its text, a blank line, and what is written in the empty
      // field; the server checks it as any edit (hash, Markanto, nothing else changed)
      if (below) openEditor(blockId, blockEl, '', { after: text })
      else openEditor(blockId, blockEl, text, { place, word })
    } catch (error) {
      // openEditor sets the open block first; without this reset no block could be edited any more.
      close()
      failAction(error)
    }
  }

  async function save(blockId: string, blockEl: HTMLElement, saveBtn: HTMLButtonElement) {
    const written = state.textarea?.value
    if (written === undefined) return
    // nothing changed, or an empty new block: no edit, the field just closes
    if (written === opened?.text || (state.after !== null && !written.trim())) {
      close()
      return
    }
    // a new block goes to the server alone, which writes it after the block (plugin.ts, handlePatch: below)
    const below = state.after !== null

    saveBtn.disabled = true
    try {
      clearHash()
    } catch (error) {
      failAction(error)
      opened?.showSave()
      return
    }

    try {
      const res = await post('/__hadley/patch', { blockId, newText: written, ...(below ? { below: true } : {}) })

      if (res.ok) {
        close()
        parts.saved(below ? null : blockEl)
        return
      }

      const data = await answer(res)

      if (res.status === 409) {
        alert(T.fileChangedReload)
        location.reload()
        return
      }

      if (res.status === 422) {
        alert(buildParseErrorMessage(data))
        opened?.showSave()
        state.textarea?.focus()
        return
      }

      alert(T.saveError(res.status, serverError(data)))
      opened?.showSave()
    } catch {
      alert(T.connectionFailedRetry)
      opened?.showSave()
    }
  }

  // Ctrl+S or Ctrl+Enter (Cmd on a Mac) saves the open block, not the page
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+Enter is the chat's: it rewrites the block (addons/chat)
    const saves = e.key.toLowerCase() === 's' || (e.key === 'Enter' && !e.shiftKey)
    if (!state.block || !(e.ctrlKey || e.metaKey) || !saves) return
    e.preventDefault()
    // unchanged, Save is off: the keys only close the field
    if (state.textarea && state.textarea.value === opened?.text) return close()
    state.wrapper?.querySelector<HTMLElement>('.hadley-save-btn')?.click()
  })

  return { open, close, cancel }
}
