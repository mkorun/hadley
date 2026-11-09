// The files of the bundle.
//
// In a drawer under the field (drawers.ts), the files that lie beside the page's Markdown (the dev server lists them,
// bundle.ts): a click puts one in at the caret, an image as `![](name)` with the caret in its alt text, any other file
// as a link. The text stays text: what it says is saved as any edit. A picture shows larger once the pointer rests on
// it (file-preview.ts). Each file can be taken away, after a question in the drawer that says whether the page still
// names it; it goes into the site's .hadley/trash/ (addons/editor/trash.ts), not out of the world.
import { askInPlace } from '../core/ask.ts'
import { el, fitTextarea } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { post, answer, serverError } from '../core/request.ts'
import { spotFor } from '../core/spot.ts'
import { state } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'
import type { Drawers } from './drawers.ts'
import { previewOn } from './file-preview.ts'

interface Listed {
  name: string
  image: boolean
  used: boolean
}

/** The files of `blockId`'s bundle in their drawer, in place of those shown, while `textarea` is the open field. */
export async function bundleFiles(blockId: string, textarea: HTMLTextAreaElement, tools: Drawers): Promise<void> {
  let files: unknown
  try {
    const res = await fetch(withLang(`/__hadley/files/${blockId}`))
    if (!res.ok) return
    files = ((await res.json()) as { files?: unknown }).files
  } catch {
    return
  }
  if (!Array.isArray(files) || state.textarea !== textarea) return
  const listed = (files as Partial<Listed>[]).filter((file): file is Listed => typeof file?.name === 'string')
  // the last one taken away: no drawer for none
  if (listed.length === 0) return tools.remove('files')
  const strip = el('div', 'hadley-files')
  strip.setAttribute('role', 'group')
  strip.setAttribute('aria-label', T.filesLabel)
  const drawer = tools.drawer('files', T.filesToggle(listed.length), icon('attach'))
  const again = () => bundleFiles(blockId, textarea, tools)
  for (const file of listed) strip.append(item(blockId, textarea, file, drawer, again))
  // in place of the ones it showed, after a picture was added or a file taken away
  drawer.replaceChildren(strip)
}

/** A file: a button that puts it in, and one that takes it away. */
function item(
  blockId: string,
  textarea: HTMLTextAreaElement,
  file: Listed,
  drawer: HTMLElement,
  again: () => Promise<void>,
): HTMLElement {
  const box = el('span', 'hadley-file-item')
  const button = el('button', 'hadley-file')
  button.type = 'button'
  button.title = T.insertFile(file.name)
  button.setAttribute('aria-label', T.insertFile(file.name))
  const src = `/__hadley/files/${blockId}/${encodeURIComponent(file.name)}`
  if (file.image) {
    const img = el('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    button.append(img)
    previewOn(button, src)
  } else {
    button.prepend(icon('file'))
  }
  const name = el('span')
  name.textContent = file.name
  button.append(name)
  // the field keeps the focus and its caret
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', () => {
    // not inside an image or link the caret stands in: after it
    const empty = textarea.selectionStart === textarea.selectionEnd
    const start = empty ? spotFor(textarea.value, textarea.selectionStart) : textarea.selectionStart
    const link = file.image ? `![](${file.name})` : `[${file.name}](${file.name})`
    textarea.focus()
    if (empty) textarea.setSelectionRange(start, start)
    document.execCommand('insertText', false, link)
    // an image waits for its alt text, a link is done
    const caret = file.image ? start + 2 : start + link.length
    textarea.setSelectionRange(caret, caret)
    fitTextarea(textarea)
  })

  const remove = el('button', 'hadley-file-delete')
  remove.type = 'button'
  remove.title = T.deleteFile(file.name)
  remove.setAttribute('aria-label', T.deleteFile(file.name))
  remove.append(icon('delete'))
  remove.addEventListener('click', () => ask(blockId, file, drawer, again))
  box.append(button, remove)
  return box
}

/** The question before a file is taken away, at the top of the drawer (core/ask.ts). */
function ask(blockId: string, file: Listed, drawer: HTMLElement, again: () => Promise<void>): void {
  drawer.querySelector('.hadley-file-ask')?.remove()
  askInPlace({
    place: (question) => drawer.prepend(question),
    question: file.used ? T.deleteFileUsed(file.name) : T.deleteFileAsk(file.name),
    yes: T.delete,
    no: T.cancel,
    className: 'hadley-file-ask',
    async then() {
      const res = await post('/__hadley/trash', { block: blockId, name: file.name }).catch(() => undefined)
      if (!res?.ok) return res ? serverError(await answer(res)) : T.connectionFailedDev
      await again()
    },
  })
}
