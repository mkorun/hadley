// A picture added to the bundle.
//
// A PNG or JPEG dropped on the field, or pasted into it, goes into the page's bundle (plugin.ts, handleUpload) under
// the name the author gives it in a small form above the files, and then in at the caret, as a click on a file puts it
// in. A name the bundle has already asks whether to replace that file. A paste that holds text is text: an office
// program puts a picture of what was copied beside it.
import { el, fitTextarea } from '../core/dom.ts'
import { spotFor } from '../core/spot.ts'
import { answer } from '../core/request.ts'
import { state } from '../core/state.ts'
import { T, withLang } from '../core/texts.ts'

const PICTURE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg' }

type Refresh = (blockId: string, textarea: HTMLTextAreaElement, toolbar: HTMLElement) => Promise<void>

/** Pictures dropped on or pasted into `textarea`; `refresh` shows the bundle's files anew once one is in. */
export function acceptPictures(
  blockId: string,
  textarea: HTMLTextAreaElement,
  toolbar: HTMLElement,
  refresh: Refresh,
): void {
  const take = (event: Event, files: FileList | undefined, pasted: boolean) => {
    if (!files || files.length === 0) return
    event.preventDefault()
    const file = [...files].find((each) => Object.hasOwn(PICTURE_TYPES, each.type))
    if (file) addPicture(blockId, textarea, toolbar, file, pasted, refresh)
    else note(toolbar, T.onlyPngJpeg)
  }
  // the whole field takes a drop, its text, toolbar and drawers alike (Michael, 2026-11-09); the picture goes in at the
  // caret, wherever it was let go
  const target = toolbar.parentElement ?? textarea
  // dragleave fires for each child the pointer crosses: only when it leaves the field is the frame off
  target.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    target.classList.add('hadley-drop')
  })
  target.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) target.classList.remove('hadley-drop')
  })
  target.addEventListener('drop', (e) => {
    target.classList.remove('hadley-drop')
    take(e, e.dataTransfer?.files, false)
  })
  textarea.addEventListener('paste', (e) => {
    if (!e.clipboardData?.types.includes('text/plain')) take(e, e.clipboardData?.files, true)
  })
}

/** A name for a picture from its file's: lower case, its words joined by `-`; a pasted one named by its time. */
function suggestedName(file: File, pasted: boolean): string {
  const ext = file.type === 'image/jpeg' && /\.jpeg$/i.test(file.name) ? 'jpeg' : PICTURE_TYPES[file.type]
  // 2026-11-06-1430, in the author's own time
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const base = pasted ? `${T.pastedName}-${stamp}` : file.name.replace(/\.[^.]*$/, '')
  const clean = base
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 90)
  return `${clean || `${T.pastedName}-${stamp}`}.${ext}`
}

/** A line above the toolbar that says something, for a while: not in the files' drawer, which may be folded. */
function note(toolbar: HTMLElement, text: string): void {
  const line = el('p', 'hadley-add-note')
  line.setAttribute('role', 'status')
  line.textContent = text
  toolbar.parentElement?.querySelector('.hadley-add-note')?.remove()
  toolbar.before(line)
  setTimeout(() => line.remove(), 8000)
}

function addPicture(
  blockId: string,
  textarea: HTMLTextAreaElement,
  toolbar: HTMLElement,
  file: File,
  pasted: boolean,
  refresh: Refresh,
): void {
  const wrapper = toolbar.parentElement
  wrapper?.querySelector('.hadley-add')?.remove()
  // where it goes in, as the caret was when it came; not inside an image or link the caret stands in (spot.ts)
  const at = textarea.selectionStart === textarea.selectionEnd ? spotFor(textarea.value, textarea.selectionStart) : -1
  const caret = at === -1 ? ([textarea.selectionStart, textarea.selectionEnd] as const) : ([at, at] as const)
  const preview = URL.createObjectURL(file)

  const form = el('form', 'hadley-add')
  form.setAttribute('aria-label', T.addPictureLabel)
  const img = el('img')
  img.src = preview
  img.alt = ''
  const label = el('label')
  label.textContent = T.pictureName
  const input = el('input')
  input.type = 'text'
  input.value = suggestedName(file, pasted)
  input.spellcheck = false
  input.maxLength = 100
  label.append(input)
  const button = (text: string, className: string, type: 'button' | 'submit' = 'button') => {
    const b = el('button', className)
    b.type = type
    b.textContent = text
    return b
  }
  const add = button(T.addPicture, 'hadley-save-btn', 'submit')
  const replace = button(T.replacePicture, 'hadley-cancel-btn')
  replace.hidden = true
  const cancel = button(T.cancel, 'hadley-cancel-btn')
  const message = el('p', 'hadley-add-message')
  message.setAttribute('role', 'status')
  form.append(img, label, add, replace, cancel, message)

  const close = () => {
    URL.revokeObjectURL(preview)
    form.remove()
    if (state.textarea === textarea) textarea.focus()
  }
  const send = async (name: string, replacing: boolean) => {
    add.disabled = replace.disabled = true
    message.textContent = ''
    try {
      const replaces = replacing ? '&replace=1' : ''
      const query = `block=${encodeURIComponent(blockId)}&name=${encodeURIComponent(name)}${replaces}`
      const res = await fetch(withLang(`/__hadley/upload?${query}`), {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await answer(res)
      if (res.ok) {
        close()
        if (state.textarea !== textarea) return
        textarea.setSelectionRange(caret[0], caret[1])
        document.execCommand('insertText', false, `![](${String(data['name'])})`)
        // the caret in its alt text, as a click on the file leaves it
        textarea.setSelectionRange(caret[0] + 2, caret[0] + 2)
        fitTextarea(textarea)
        void refresh(blockId, textarea, toolbar)
        if (data['located']) note(toolbar, T.pictureLocated(String(data['name'])))
        return
      }
      const exists = data['exists']
      if (res.status === 409 && typeof exists === 'string') {
        message.textContent = T.pictureExists(exists)
        replace.hidden = false
        replace.onclick = () => void send(exists, true)
        return
      }
      message.textContent = typeof data['error'] === 'string' ? data['error'] : T.unknownError
    } catch {
      message.textContent = T.connectionFailedRetry
    } finally {
      add.disabled = replace.disabled = false
    }
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    replace.hidden = true
    void send(input.value.trim(), false)
  })
  cancel.addEventListener('click', close)
  // Esc closes the form, not the editor around it
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  })
  input.addEventListener('input', () => {
    replace.hidden = true
    message.textContent = ''
  })
  // above the toolbar, in view whether the files' drawer is open or folded (Michael, 2026-11-09)
  toolbar.before(form)
  input.focus()
  input.setSelectionRange(0, input.value.lastIndexOf('.'))
}
