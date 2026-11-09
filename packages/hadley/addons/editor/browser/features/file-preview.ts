// A larger look at a picture of the bundle (files.ts; Michael, 2026-11-09: two thumbnails can look alike): once the
// pointer rests on it, or the keyboard comes to it, it shows above, at most 240 pixels, faded in; it goes as the
// pointer or the focus leaves, or as the picture goes in. One at a time, in the body, over everything.
import { el } from '../core/dom.ts'

const REST = 400
const GAP = 8

let shown: HTMLElement | null = null

const hide = () => {
  shown?.remove()
  shown = null
}

function show(anchor: HTMLElement, src: string): void {
  hide()
  const box = el('div', 'hadley-file-preview')
  box.setAttribute('aria-hidden', 'true')
  const img = el('img')
  img.alt = ''
  img.src = src
  box.append(img)
  document.body.append(box)
  shown = box
  // placed once its size is known: above the file, else below it, inside the window
  const place = () => {
    const at = anchor.getBoundingClientRect()
    const size = box.getBoundingClientRect()
    const above = at.top - size.height - GAP
    box.style.top = `${above >= GAP ? above : at.bottom + GAP}px`
    box.style.left = `${Math.max(GAP, Math.min(at.left, innerWidth - size.width - GAP))}px`
    box.classList.add('is-shown')
  }
  if (img.complete) place()
  else img.addEventListener('load', place, { once: true })
}

/** `anchor` shows the picture at `src` larger once the pointer rests on it, or the focus comes to it. */
export function previewOn(anchor: HTMLElement, src: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(() => show(anchor, src), REST)
  }
  const off = () => {
    clearTimeout(timer)
    hide()
  }
  anchor.addEventListener('mouseenter', soon)
  anchor.addEventListener('focus', soon)
  anchor.addEventListener('mouseleave', off)
  anchor.addEventListener('blur', off)
  anchor.addEventListener('click', off)
}
