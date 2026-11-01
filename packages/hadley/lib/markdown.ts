/** A page's Markdown twin: public Lima front matter and canonical Markanto with its destinations made absolute. */
import { format, type Document } from '@markantolang/parser'
import { readDestination, type Built, type Use } from '../case/index.ts'
import type { Page, Site } from './site.ts'

const quoted = (value: string): string => JSON.stringify(value)

const authorNames = (author: Page['metadata']['author']): string[] => {
  if (typeof author === 'string') return [author]
  if (author && typeof author.name === 'string') return [author.name]
  return []
}

const frontMatter = (site: Site, page: Page): string => {
  const language = site.content[page.language]!
  const { metadata } = page
  const lines = [
    `title: ${quoted(metadata.title)}`,
    ...(metadata.description ? [`description: ${quoted(metadata.description)}`] : []),
    `url: ${quoted(language.origin + page.urlPath)}`,
    `language: ${quoted(page.language)}`,
    ...(metadata.publishFrom ? [`published: ${metadata.publishFrom.toISOString().slice(0, 10)}`] : []),
    ...(metadata.updatedAt ? [`updated: ${metadata.updatedAt.toISOString().slice(0, 10)}`] : []),
  ]
  const authors = authorNames(metadata.author)
  if (authors.length === 1) lines.push(`author: ${quoted(authors[0]!)}`)
  else if (authors.length > 1) lines.push(`author: [${authors.map(quoted).join(', ')}]`)
  if (metadata.tags?.length) lines.push(`tags: [${metadata.tags.map(quoted).join(', ')}]`)
  return `---\n${lines.join('\n')}\n---\n`
}

const builtHref = (built: Built, destination: string): string => {
  if (built.kind === 'failed') throw new Error(`${destination} ${built.reason}`)
  if (built.kind === 'picture') return built.picture.src
  return built.href
}

/** Clone the semantic document, dropping comments and changing only fields that hold destinations. */
const documentFor = (site: Site, page: Page): Document => {
  if (page.doc.parsed.status !== 'ok') throw new Error(`${page.file}: its invalid Markanto has no Markdown twin`)
  const language = site.content[page.language]!
  if (!language.origin) throw new Error('config.lima: site.origin is missing, and a twin names its links in full')
  const base = language.origin + page.urlPath

  const destination = (raw: string, use: Use, node: object): string | undefined => {
    let value = raw
    if (use === 'link' && value.startsWith('$')) {
      const named = value.slice(1)
      const hashAt = named.indexOf('#')
      const id = hashAt === -1 ? named : named.slice(0, hashAt)
      const fragment = hashAt === -1 ? '' : named.slice(hashAt)
      const versions = site.translationMappings[id]
      const path = versions?.[page.language]
      if (path === undefined) {
        const reason = versions ? `names a page with no version in ${page.language}` : 'names no page'
        throw new Error(`${raw} ${reason}`)
      }
      value = path + fragment
    }
    const read = readDestination(value, use, page.urlPath, language.origin)
    if (read.kind === 'refused') throw new Error(`${raw} ${read.reason}`)
    if (read.kind === 'external') return read.href
    if (read.kind === 'self') return read.href.startsWith('#') ? read.href : new URL(read.href, base).href
    if (read.kind === 'bundle' || read.kind === 'path') {
      const built = page.files?.get(node)
      // Destination-shaped data-* attributes are checked by the HTML renderer but do not request a file.
      const href = built ? builtHref(built, raw) : read.kind === 'path' ? read.href : undefined
      return href === undefined ? undefined : new URL(href, base).href
    }
  }

  const clone = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const cloned: unknown[] = []
      const append = (made: unknown) => {
        const previous = cloned.at(-1)
        if (
          previous &&
          typeof previous === 'object' &&
          (previous as { type?: string }).type === 'text' &&
          made &&
          typeof made === 'object' &&
          (made as { type?: string }).type === 'text'
        ) {
          ;(previous as { value: string }).value += (made as { value: string }).value
        } else cloned.push(made)
      }
      for (const item of value) {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          if (
            record.type === 'commentBlock' ||
            (record.block as { type?: string } | undefined)?.type === 'commentBlock'
          )
            continue
          if (record.type === 'link' && typeof record.href === 'string' && record.href.startsWith('$')) {
            const id = record.href.slice(1).split('#', 1)[0]!
            if (site.unpublishedIds[page.language]?.has(id)) {
              for (const child of (clone(record.children) as unknown[]) ?? []) append(child)
              continue
            }
          }
        }
        const made = clone(item)
        if (
          made &&
          typeof made === 'object' &&
          ((made as { type?: string }).type === 'container' || (made as { type?: string }).type === 'quoteRegion') &&
          (made as { children?: unknown[] }).children?.length === 0
        )
          continue
        append(made)
      }
      return cloned
    }
    if (value === null || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const copy: Record<string, unknown> = {}
    const type = source.type
    for (const [key, child] of Object.entries(source)) {
      let use: Use | undefined
      if (type === 'link' && key === 'href') use = source.download === true ? 'resource' : 'link'
      else if ((type === 'inlineImage' || type === 'imageBlock') && key === 'src') use = 'resource'
      else if ((type === 'videoBlock' || type === 'audioBlock') && key === 'src') use = 'resource'
      else if (type === 'embedBlock' && key === 'target') use = 'embed'
      else if (type === 'downloadBlock' && key === 'href') use = 'resource'
      else if (key === 'preview' && typeof child === 'string') use = 'resource'
      if (use && typeof child === 'string') {
        const resolved = destination(child, use, value)
        if (resolved !== undefined) copy[key] = resolved
      } else if (key === 'dataAttrs' && child && typeof child === 'object') {
        const data: Record<string, string> = {}
        for (const [name, raw] of Object.entries(child as Record<string, string>)) {
          const resolved = /(?:href|src|url)$/.test(name) ? destination(raw, 'data', value) : raw
          if (resolved !== undefined) data[name] = resolved
        }
        copy[key] = data
      } else copy[key] = clone(child)
    }
    return copy
  }

  const document = clone(page.doc.parsed.document) as Document
  document.children.unshift({ type: 'heading', level: 1, children: [{ type: 'text', value: page.metadata.title }] })
  return document
}

export function markdownTwin(site: Site, page: Page): string {
  const formatted = format(documentFor(site, page))
  if (formatted.status !== 'ok') {
    const details = formatted.diagnostics.map((d) => d.message ?? d.category).join('; ')
    throw new Error(
      `${page.file}: the Markanto formatter cannot write its Markdown twin${details ? `: ${details}` : ''}`,
    )
  }
  return frontMatter(site, page) + formatted.source
}

export const markdownPath = (page: Page): string => page.urlPath.slice(1) + 'index.html.md'
