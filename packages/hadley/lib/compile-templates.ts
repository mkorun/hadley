import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join as joinPath, relative } from 'node:path'
import { existsExactly, isSystemFile, slashed } from './platform.ts'
import galley, {
  parse,
  type Expression,
  type GalleyOptions,
  type SyncTemplate,
  type TemplateNode,
} from '@mkorun/galley'

const HTML_ROOTS = new Set(['html', 't'])

/** `html.…` or `t.…` by name, optionally `?? ''`: the only expressions a template writes as HTML. */
function isHtmlValue(expression: Expression): boolean {
  if (expression.kind === 'binary' && expression.operator === '??') {
    return isHtmlValue(expression.left) && expression.right.kind === 'literal' && expression.right.value === ''
  }
  return (
    expression.kind === 'path' &&
    HTML_ROOTS.has(expression.root) &&
    expression.segments.length > 0 &&
    expression.segments.every((segment) => segment.kind === 'property')
  )
}

/**
 * What a template may write as HTML (`{@raw}`): what hadley made as HTML (`html.*`) and the theme's own texts (`t.*`).
 * Every other value is escaped, whatever it holds. The check reads galley's syntax tree, so `html` and `t` are the
 * names hadley gives: a template that binds either name itself (`{@const}`, `{#each}`, a snippet) is refused too.
 * Returns a message for each `{@raw}` that writes anything else and for each such binding.
 *
 * A field template of config.lima (`use` "field") gets a front-matter value as its data, so a name in it, `html` and
 * `t` too, is content: it writes no `{@raw}` at all.
 */
export function rawProblems(source: string, id = 'template', use: 'theme' | 'field' = 'theme'): string[] {
  const problems: string[] = []
  // a tag as the template writes it; a block by its opening tag
  const text = (node: TemplateNode) => {
    const whole = source.slice(node.span.start, node.span.end)
    return whole.slice(0, whole.indexOf('}') + 1)
  }
  const bind = (node: TemplateNode, name: string | null) => {
    if (name !== null && HTML_ROOTS.has(name)) problems.push(`${text(node)} binds ${name}, which hadley gives`)
  }
  const visit = (nodes: readonly TemplateNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'output' && node.raw && use === 'field') {
        problems.push(`${text(node)} writes a value as HTML; a field template writes none, its values are content`)
      } else if (node.kind === 'output' && node.raw && !isHtmlValue(node.expression)) {
        problems.push(`${text(node)} writes a value as HTML; a template writes HTML only from html.* and t.*`)
      }
      if (node.kind === 'const') bind(node, node.name)
      if (node.kind === 'each') {
        bind(node, node.item)
        bind(node, node.index)
      }
      if (node.kind === 'snippet') {
        bind(node, node.name)
        bind(node, node.param)
      }
      if (node.kind === 'if') for (const branch of node.branches) visit(branch.children)
      if (node.kind === 'each' || node.kind === 'snippet') visit(node.children)
    }
  }
  visit(parse({ id, text: source }).children)
  return problems
}

// every layout and partial galley reads is checked as it is read
const checked = (options: GalleyOptions): GalleyOptions => {
  const read = options.includes.import
  const basedir = options.includes.basedir ?? '.'
  const missing = (path: string) => new Error(`${path}: the theme has no such template, which a {@partial} includes`)
  return {
    ...options,
    includes: {
      ...options.includes,
      import: async (path, enc) => {
        // a template is found as it is spelled, also where the file system finds a name in any case (docs/platforms.md)
        const rel = slashed(relative(basedir, path))
        if (!rel.startsWith('../') && !isAbsolute(rel) && !existsExactly(basedir, rel)) throw missing(path)
        const source = await read(path, enc).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
          throw missing(path)
        })
        const problems = rawProblems(source, path)
        if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`)
        return source
      },
    },
  }
}

/**
 * The theme's heading template, templates/markup/heading.sort: what a heading of the content holds (RenderOptions
 * heading in case/types.ts). It gets the heading's `level`, `id` and content as `html.text`, and the page's `t` and
 * `meta.lang`. A theme without the file has none.
 */
export async function compileHeading(options: GalleyOptions): Promise<SyncTemplate | undefined> {
  const path = joinPath(options.includes.basedir ?? './', 'markup', 'heading.sort')
  if (!existsSync(path)) return undefined
  const source = await checked(options).includes.import(path, 'utf-8')
  const template = await galley(source, { ...checked(options), sourceId: path })
  if (template.async) throw new Error(`${path}: a heading template renders without waiting (no async snippet)`)
  return template
}

const compileTemplates = async (options: GalleyOptions & { ext?: string }) => {
  const basedir = options?.includes?.basedir ?? './'
  const ext = options.ext ?? '.chase'
  options = checked(options)

  // Partials (.sort) live in partials/ subdir and are included via {@partial} — only compile layouts (.chase)
  const tplFiles = (await readdir(basedir, { recursive: false })).filter((f) => f.endsWith(ext) && !isSystemFile(f))

  const templates: Record<string, { images: object; render: Function }> = {}

  for (const filename of tplFiles) {
    const tplSource = await options.includes.import(joinPath(basedir, filename), 'utf-8')
    const name = filename.slice(0, -ext.length)

    // Extract <galley:config> — top-level keys are namespaces (e.g. "images")
    let chaseConfig: Record<string, any> | undefined
    const configMatch = tplSource.match(/<galley:config>([\s\S]*?)<\/galley:config>/)
    if (configMatch) {
      try {
        chaseConfig = JSON.parse(configMatch[1].trim())
      } catch (e) {
        throw new Error(`Invalid <galley:config> in ${filename}: ${e}`)
      }
    }

    templates[name] = {
      images: chaseConfig?.images,
      // named, so that galley's errors name the file
      render: (await galley(tplSource, { ...options, sourceId: joinPath(basedir, filename) })).render,
    }
  }

  return templates
}

export default compileTemplates
