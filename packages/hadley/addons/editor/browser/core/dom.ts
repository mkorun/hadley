// Building the editor's elements without innerHTML: an element with its class, and SVG from a list of its parts.

const SVG = 'http://www.w3.org/2000/svg'

/** An element of `tag`, with `className` where one is given. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  return node
}

/** A part of a drawing: its tag and its attributes, in their order. */
export type Shape = readonly [tag: string, attributes: Readonly<Record<string, string>>]

/** An `<svg>` with `attributes` and `shapes`, in their order, as the HTML parser would make it from its markup. */
export function svg(attributes: Readonly<Record<string, string>>, shapes: readonly Shape[]): SVGSVGElement {
  const root = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG, tag)
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value)
    root.append(shape)
  }
  return root
}

/** The field as high as its text, up to 60 % of the window. */
export function fitTextarea(textarea: HTMLTextAreaElement): void {
  if (textarea.scrollHeight > textarea.clientHeight) {
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.6)}px`
  }
}
