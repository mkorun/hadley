// The one place where values become XML (sitemap and feed): a document is a tree of elements, and every attribute
// value and every text passes through here, escaped. Like case/html.ts for HTML.

/** An element: attributes in output order, then either nothing, one text, or elements. */
export interface XmlElement {
  name: string
  attrs: ReadonlyArray<readonly [name: string, value: string]>
  children: readonly (XmlElement | string)[]
}

export const element = (
  name: string,
  attrs: XmlElement['attrs'] = [],
  ...children: (XmlElement | string)[]
): XmlElement => ({ name, attrs, children })

const NAME = /^[a-zA-Z_][a-zA-Z0-9_.:-]*$/
// XML 1.0 cannot hold these at all, escaped or not.
const NOT_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/

function escXml(value: string): string {
  const bad = NOT_XML.exec(value)
  if (bad) {
    const code = bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    throw new Error(`XML cannot hold the character U+${code} in ${JSON.stringify(value)}`)
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function serialize(node: XmlElement, indent: string): string {
  if (!NAME.test(node.name)) throw new Error(`invalid XML element name: ${node.name}`)
  let open = `<${node.name}`
  for (const [name, value] of node.attrs) {
    if (!NAME.test(name)) throw new Error(`invalid XML attribute name: ${name}`)
    open += ` ${name}="${escXml(value)}"`
  }
  const [first] = node.children
  if (first === undefined) return `${indent}${open}/>`
  if (typeof first === 'string') {
    if (node.children.length > 1) throw new Error(`<${node.name}> holds text and something else`)
    return `${indent}${open}>${escXml(first)}</${node.name}>`
  }
  const children = node.children.map((child) => {
    if (typeof child === 'string') throw new Error(`<${node.name}> holds text and something else`)
    return serialize(child, `${indent}  `)
  })
  return `${indent}${open}>\n${children.join('\n')}\n${indent}</${node.name}>`
}

/** A UTF-8 XML document with `root`, each element on its own line, indented by two spaces per level. */
export function xmlDocument(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(root, '')}\n`
}
