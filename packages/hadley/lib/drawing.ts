/**
 * A drawing (docs/content.md, "Drawings"): an SVG of the bundle, read strictly and written again with only what a
 * drawing may hold. Its ids get the drawing's prefix, and so does every reference to one; anything a drawing may not
 * hold is an error that names its line, and nothing is dropped silently but comments, the XML declaration and the two
 * SVG namespace declarations, which a page does not need.
 *
 *   readDrawing(text, 'drawing-accuracy')  →  { attrs, inner }   the root's attributes and the checked content
 */
import { attrs as attrsHtml, escHtml } from '../case/html.ts'
import type { Drawing } from '../case/types.ts'

const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'marker',
])

// the elements that may hold text a reader sees
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc'])

// geometry, and the presentation attributes of SVG 1.1 and 2 a drawing can use; `style` is not one of them
const ATTRIBUTES = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'fx',
  'fy',
  'fr',
  'points',
  'd',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'pathLength',
  'transform',
  'viewBox',
  'preserveAspectRatio',
  'version',
  'xml:space',
  'offset',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'stop-color',
  'stop-opacity',
  'color',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'visibility',
  'display',
  'paint-order',
  'vector-effect',
  'shape-rendering',
  'text-rendering',
  'class',
  'role',
])

// the only namespaces a drawing declares, on its root; the page does not need them
const NAMESPACES: Record<string, string> = {
  xmlns: 'http://www.w3.org/2000/svg',
  'xmlns:xlink': 'http://www.w3.org/1999/xlink',
}

// what hadley says of the root itself: the alt text names the drawing
const ROOT_NAMING = new Set(['role', 'aria-label', 'aria-labelledby', 'aria-hidden'])

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/
const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const ARIA = /^aria-[a-z]+$/
const ID_LISTS = new Set(['aria-labelledby', 'aria-describedby'])
const URL_REFERENCE = /url\(\s*['"]?#([A-Za-z_][A-Za-z0-9_.-]*)['"]?\s*\)/g
const FORBIDDEN_VALUE = /javascript:|expression\(|url\(/i
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

interface Element {
  name: string
  attrs: [string, string][]
  children: (Element | string)[]
  line: number
}

/** What a drawing may not hold, and the line of its file that holds it. */
export class DrawingError extends Error {
  readonly line: number
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.line = line
  }
}

/** Reads an SVG strictly: elements, attributes in quotes, text, comments; no DOCTYPE, no CDATA, no named entity. */
function parse(text: string): Element {
  let at = text.startsWith('﻿') ? 1 : 0
  const lineAt = (position: number) => text.slice(0, position).split('\n').length
  const fail = (message: string, position = at): never => {
    throw new DrawingError(lineAt(position), message)
  }
  const decode = (raw: string, position: number) =>
    raw.replace(/&([^;\s&]*);?/g, (whole, entity: string) => {
      if (!whole.endsWith(';')) fail('a `&` that is no character reference', position)
      if (ENTITIES[entity] !== undefined) return ENTITIES[entity]
      const hex = /^#x([0-9A-Fa-f]{1,6})$/.exec(entity)
      const dec = /^#([0-9]{1,7})$/.exec(entity)
      const code = hex ? parseInt(hex[1]!, 16) : dec ? parseInt(dec[1]!, 10) : undefined
      if (code === undefined)
        return fail(`the entity &${entity}; (only &amp; &lt; &gt; &quot; &apos; and numbers)`, position)
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return fail(`the character reference &${entity}; names no character`, position)
      return String.fromCodePoint(code)
    })

  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at]!)) at++
  }
  // what may stand between elements: space and comments; an XML declaration only before anything else
  const skipMisc = (first: boolean) => {
    for (;;) {
      skipSpace()
      if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at + 4)
        if (end < 0) fail('a comment that does not end')
        at = end + 3
      } else if (first && text.startsWith('<?xml', at) && /\s/.test(text[at + 5] ?? '')) {
        const end = text.indexOf('?>', at)
        if (end < 0) fail('an XML declaration that does not end')
        at = end + 2
        first = false
      } else return
    }
  }
  const refuseMarkup = () => {
    if (text.startsWith('<!DOCTYPE', at) || text.startsWith('<!doctype', at)) fail('a DOCTYPE')
    if (text.startsWith('<![CDATA[', at)) fail('a CDATA section')
    if (text.startsWith('<!', at)) fail('a declaration (`<!…`)')
    if (text.startsWith('<?', at)) fail('a processing instruction (`<?…`)')
  }

  const element = (): Element => {
    const start = at
    at++ // <
    const name = /^[^\s/>]+/.exec(text.slice(at))?.[0] ?? ''
    if (!NAME.test(name)) fail(`a tag without a valid name`, start)
    at += name.length
    const node: Element = { name, attrs: [], children: [], line: lineAt(start) }
    const seen = new Set<string>()
    for (;;) {
      const before = at
      skipSpace()
      if (text.startsWith('/>', at)) {
        at += 2
        return node
      }
      if (text[at] === '>') {
        at++
        break
      }
      if (at === before) fail(`<${name}>: an attribute without space before it`)
      const attr = /^[^\s=/>]+/.exec(text.slice(at))?.[0] ?? ''
      if (!NAME.test(attr)) fail(`<${name}>: an attribute without a valid name`)
      at += attr.length
      skipSpace()
      if (text[at] !== '=') fail(`<${name}>: the attribute ${attr} has no value`)
      at++
      skipSpace()
      const quote = text[at]
      if (quote !== '"' && quote !== "'") fail(`<${name}>: the value of ${attr} is not in quotes`)
      const end = text.indexOf(quote!, at + 1)
      if (end < 0) fail(`<${name}>: the value of ${attr} does not end`)
      const raw = text.slice(at + 1, end)
      if (raw.includes('<')) fail(`<${name}>: a \`<\` in the value of ${attr}`)
      if (seen.has(attr)) fail(`<${name}>: the attribute ${attr} twice`)
      seen.add(attr)
      node.attrs.push([attr, decode(raw, at)])
      at = end + 1
    }
    // content, up to the matching end tag
    for (;;) {
      if (at >= text.length) fail(`<${name}> does not end`, start)
      if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at + 4)
        if (end < 0) fail('a comment that does not end')
        at = end + 3
        continue
      }
      if (text.startsWith('</', at)) {
        const end = text.indexOf('>', at)
        const closing = text.slice(at + 2, end < 0 ? undefined : end).trim()
        if (closing !== name) fail(`</${closing}> where </${name}> was expected`)
        at = end + 1
        return node
      }
      if (text[at] === '<') {
        refuseMarkup()
        node.children.push(element())
        continue
      }
      const next = text.indexOf('<', at)
      const end = next < 0 ? text.length : next
      node.children.push(decode(text.slice(at, end), at))
      at = end
    }
  }

  skipMisc(true)
  refuseMarkup()
  if (text[at] !== '<') fail('no element: a drawing is an `<svg>`')
  const root = element()
  skipMisc(false)
  if (at < text.length) fail('something after the end of the `<svg>`')
  return root
}

/**
 * Reads an SVG as a drawing for a page, its ids prefixed with `prefix` (unique on the page). Throws a DrawingError,
 * which names the line, for anything a drawing may not hold.
 */
export function readDrawing(text: string, prefix: string): Drawing {
  const root = parse(text)
  if (root.name !== 'svg') throw new DrawingError(root.line, `<${root.name}>: a drawing is an <svg>`)

  // every id of the file, once; a reference must name one of them
  const ids = new Set<string>()
  const collect = (node: Element) => {
    for (const [name, value] of node.attrs) {
      if (name !== 'id') continue
      if (!ID.test(value)) throw new DrawingError(node.line, `<${node.name}>: the id "${value}" is not a plain name`)
      if (ids.has(value)) throw new DrawingError(node.line, `<${node.name}>: the id "${value}" twice`)
      ids.add(value)
    }
    for (const child of node.children) if (typeof child !== 'string') collect(child)
  }
  collect(root)
  const own = (node: Element, id: string) => {
    if (!ids.has(id)) throw new DrawingError(node.line, `<${node.name}>: #${id} names no element of the drawing`)
    return `${prefix}-${id}`
  }

  const checkedAttrs = (node: Element, isRoot: boolean): [string, string][] => {
    const out: [string, string][] = []
    for (const [name, value] of node.attrs) {
      const where = `<${node.name}> ${name}`
      if (isRoot && name in NAMESPACES) {
        if (value !== NAMESPACES[name]) throw new DrawingError(node.line, `${where}: not the SVG namespace`)
        continue
      }
      if (isRoot && ROOT_NAMING.has(name)) continue
      if (name === 'id') {
        out.push(['id', own(node, value)])
        continue
      }
      if (name === 'href' || name === 'xlink:href') {
        const id = node.name === 'use' ? /^#([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(value)?.[1] : undefined
        if (id === undefined) throw new DrawingError(node.line, `${where}: a link; only <use> may name an #id`)
        out.push(['href', `#${own(node, id)}`])
        continue
      }
      if (ID_LISTS.has(name)) {
        out.push([
          name,
          value
            .trim()
            .split(/\s+/)
            .map((id) => own(node, id))
            .join(' '),
        ])
        continue
      }
      if (!ATTRIBUTES.has(name) && !ARIA.test(name)) {
        const why = /^on/i.test(name) ? 'an event attribute' : name === 'style' ? 'a style attribute' : 'an attribute'
        throw new DrawingError(node.line, `${where}: ${why} a drawing may not hold`)
      }
      // a value may name an element of the drawing as url(#id), and nothing else as a URL
      const prefixed = value.replace(URL_REFERENCE, (_whole, id: string) => `url(#${own(node, id)})`)
      if (FORBIDDEN_VALUE.test(prefixed.replace(URL_REFERENCE, '')))
        throw new DrawingError(node.line, `${where}: a URL or script in its value`)
      out.push([name, prefixed])
    }
    return out
  }

  const WHY: Record<string, string> = {
    script: 'a script',
    style: 'a style sheet',
    foreignObject: 'HTML',
    image: 'an image',
    a: 'a link',
    svg: 'an <svg> inside the drawing,',
  }
  const write = (node: Element): string =>
    node.children
      .map((child) => {
        if (typeof child !== 'string') {
          if (!ELEMENTS.has(child.name) || child.name === 'svg')
            throw new DrawingError(
              child.line,
              `<${child.name}>: ${WHY[child.name] ?? 'an element'} a drawing may not hold`,
            )
          return `<${child.name}${attrsHtml(checkedAttrs(child, false))}>${write(child)}</${child.name}>`
        }
        if (child.trim() && !TEXT_ELEMENTS.has(node.name))
          throw new DrawingError(node.line, `<${node.name}>: text outside <text>, <tspan>, <title> and <desc>`)
        return escHtml(child)
      })
      .join('')

  return { attrs: checkedAttrs(root, true), inner: write(root) }
}
