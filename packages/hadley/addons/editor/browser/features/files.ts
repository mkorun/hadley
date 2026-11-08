// The files of the bundle.
//
// Under the field, the files that lie beside the page's Markdown (the dev server lists them, plugin.ts): a click puts
// one in at the caret, an image as `![](name)` with the caret in its alt text, any other file as a link. The text stays
// text: what it says is saved as any edit.
import { el, fitTextarea } from '../core/dom.ts'
import { icon } from '../core/icons.ts'
import { state } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'

/** The files of `blockId`'s bundle above `toolbar`, in place of those shown, while `textarea` is the open field. */
export async function bundleFiles(blockId: string, textarea: HTMLTextAreaElement, toolbar: HTMLElement): Promise<void> {
  let files: unknown
  try {
    const res = await fetch(withLang(`/__hadley/files/${blockId}`))
    if (!res.ok) return
    files = ((await res.json()) as { files?: unknown }).files
  } catch {
    return
  }
  if (!Array.isArray(files) || files.length === 0 || state.textarea !== textarea) return
  const strip = el('div', 'hadley-files')
  strip.setAttribute('role', 'group')
  strip.setAttribute('aria-label', T.filesLabel)
  for (const file of files as { name?: unknown; image?: unknown }[]) {
    const fileName = file?.name
    if (typeof fileName !== 'string') continue
    const button = el('button', 'hadley-file')
    button.type = 'button'
    button.title = T.insertFile(fileName)
    button.setAttribute('aria-label', T.insertFile(fileName))
    if (file.image) {
      const img = el('img')
      img.src = `/__hadley/files/${blockId}/${encodeURIComponent(fileName)}`
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      button.append(img)
    } else {
      button.prepend(icon('file'))
    }
    const name = el('span')
    name.textContent = fileName
    button.append(name)
    // the field keeps the focus and its caret
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', () => {
      const start = textarea.selectionStart
      const link = file.image ? `![](${fileName})` : `[${fileName}](${fileName})`
      textarea.focus()
      document.execCommand('insertText', false, link)
      // an image waits for its alt text, a link is done
      const caret = file.image ? start + 2 : start + link.length
      textarea.setSelectionRange(caret, caret)
      fitTextarea(textarea)
    })
    strip.append(button)
  }
  // in place of the one it shows anew, after a picture was added
  toolbar.parentElement?.querySelector('.hadley-files')?.remove()
  toolbar.before(strip)
}
