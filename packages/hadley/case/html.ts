// The one place where values become HTML: every attribute value and every text passes through here, escaped.
// scripts/check-html.ts keeps attribute interpolation (`="${`) out of the other files of the content path.

import type { Picture } from './types.ts'

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// `>` too, so a `>` in serialized HTML always ends a tag.
export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** An attribute value: text or a number, `true` for a boolean attribute, `undefined` for no attribute at all. */
export type AttrValue = string | number | true | undefined

/** Attributes in output order. */
export type Attrs = ReadonlyArray<readonly [name: string, value: AttrValue]>

/** Renders attributes as ` name="value"` in the given order; throws on a name that appears twice. */
export function attrs(list: Attrs): string {
  const seen = new Set<string>()
  let html = ''
  for (const [name, value] of list) {
    if (value === undefined) continue
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(name)) throw new Error(`invalid attribute name: ${name}`)
    if (seen.has(name)) throw new Error(`attribute ${name} given twice`)
    seen.add(name)
    html += value === true ? ` ${name}` : ` ${name}="${escAttr(String(value))}"`
  }
  return html
}

export function startTag(name: string, list: Attrs = []): string {
  return `<${name}${attrs(list)}>`
}

/** JSON as a `<script type="application/ld+json">` element; `<` becomes `\u003c`, so no value can end the element. */
export function jsonScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value, null, 2).replace(/</g, '\\u003c')}\n</script>`
}

/**
 * A `<picture>` with a `<source>` per format and the `<img>` fallback; `loading` follows width and height on the
 * `<img>`. A figure and the cover differ only in `alt`, `loading` and the picture's own attributes.
 */
export function pictureHtml(picture: Picture, alt: string, loading: Attrs, pictureAttrs: Attrs = []): string {
  const sources = picture.sources.map(
    (source) =>
      `\n  ${startTag('source', [
        ['type', source.type],
        ['srcset', source.srcset],
        ['sizes', picture.sizes],
      ])}`,
  )
  const img = startTag('img', [
    ['src', picture.src],
    ['alt', alt],
    ['width', picture.width || undefined],
    ['height', picture.height || undefined],
    ...loading,
  ])
  return `${startTag('picture', pictureAttrs)}${sources.join('')}\n  ${img}\n</picture>`
}
