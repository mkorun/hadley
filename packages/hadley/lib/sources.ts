/**
 * The pages and data of other git repositories (docs/sources.md). config.lima `sources` names each repository, the
 * commit to read it at, a folder, its pages and its data; they are read with git at that commit, the pages' links made
 * to lead where they lead in the repository, and written into .hadley/cache/sources/<source>/<key>/: the pages as
 * bundles of <root>/, which the build reads as it reads content/, the data as data/<name>.lima (lib/load-site.ts). A
 * source is read again only when what makes its files changes; the fields of its pages are not in the files, the build
 * gives them to the pages as it reads them.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { parseCore } from '@limaformat/lima'
import { CONTENT_ROOTS } from './bundles.ts'
import type { Config } from './site.ts'

const GIT_TIMEOUT_MS = 120_000
// the name of a source
const NAME = /^[a-z0-9][a-z0-9-]*$/
// the name of a file of its folder without .md: a dot only between two parts, so never .., nor a hidden file
const PAGE = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/
const PICTURE = /\.(png|jpe?g|webp|avif|gif|svg)$/i
// the name templates read a data file by, site.data.<name>, and the file: a LIMA file of the folder, named as a page is
const DATA_NAME = /^[a-z][a-z0-9]*$/
const DATA_FILE = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.lima$/
// a repository on GitHub, whose files GitHub shows at /blob/<ref>/<path>; no user, no password
const GITHUB = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
// a commit or a tag: never an option of git (-…), nor a range (..)
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/
// what a source may bring: a file, and all its files together
const FILE_BYTES = 16 * 1024 * 1024
const SOURCE_BYTES = 256 * 1024 * 1024

type Root = (typeof CONTENT_ROOTS)[number]

/** A source of config.lima, checked. */
export interface Source {
  name: string
  repository: string
  ref: string
  checkout: string | undefined // an absolute path
  frozen: boolean // a version kept on purpose: a build does not count the commits after ref
  path: string // the folder in the repository, without a slash at either end; '' for its root
  root: Root | undefined // with its pages only
  /** by bundle id, the fields of its page: those of its entry, and its URL path */
  pages: Record<string, Record<string, unknown>>
  /** by the name templates read it by, the file of a data file in the repository */
  data: Record<string, string>
}

/** The folder of a source's bundles, and by bundle id what is wrong with a page's links. */
export interface SourceFiles {
  dir: string
  problems: Record<string, string[]>
}

const text = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The sources of config.lima; a value that is missing, or not what it must be, stops the build. */
export function sourcesOf(config: Config, siteDir: string): Source[] {
  const sources: unknown = config.sources
  if (sources === undefined) return []
  if (sources === null || typeof sources !== 'object' || Array.isArray(sources))
    throw new Error('config.lima: sources is a block of sources by their names (docs/sources.md)')
  const list = Object.entries(sources).map(([name, spec]) => {
    const where = `config.lima: sources.${name}`
    if (!NAME.test(name)) throw new Error(`${where}: a source is named with lower-case letters, digits and -`)
    if (spec === null || typeof spec !== 'object') throw new Error(`${where} is a block (docs/sources.md)`)
    const { repository, ref, checkout, frozen, path, root, urlPath, pages, data } = spec as Record<string, unknown>
    if (!text(repository) || !GITHUB.test(repository))
      throw new Error(`${where}.repository is a repository on GitHub, https://github.com/<owner>/<name>`)
    if (!text(ref) || !REF.test(ref) || ref.includes('..'))
      throw new Error(`${where}.ref is the commit or tag to read it at`)
    if (checkout !== undefined && !text(checkout)) throw new Error(`${where}.checkout is the path of a clone`)
    if (frozen !== undefined && typeof frozen !== 'boolean') throw new Error(`${where}.frozen is true or false`)
    if (
      path !== undefined &&
      (!text(path) || path.startsWith('/') || path.endsWith('/') || path.split('/').includes('..'))
    )
      throw new Error(`${where}.path is a folder of the repository, such as docs`)
    const folder = typeof path === 'string' ? path : ''
    const files = folder === '' ? 'its repository' : folder
    if (pages === undefined && data === undefined) throw new Error(`${where} gives pages, data or both`)
    if (
      pages !== undefined &&
      (pages === null || typeof pages !== 'object' || Array.isArray(pages) || Object.keys(pages).length === 0)
    )
      throw new Error(`${where}.pages names the files of ${files}, each with its fields`)
    if (pages !== undefined && (!text(root) || !(CONTENT_ROOTS as readonly string[]).includes(root)))
      throw new Error(`${where}.root is one of ${CONTENT_ROOTS.join(', ')}`)
    if (pages !== undefined && (!text(urlPath) || !urlPath.startsWith('/') || !urlPath.endsWith('/')))
      throw new Error(`${where}.urlPath is the URL path the pages stand under, such as /docs/`)
    if (pages === undefined && (root !== undefined || urlPath !== undefined))
      throw new Error(`${where}: root and urlPath belong to its pages, and it gives none`)
    const dataFiles: Record<string, string> = {}
    if (data !== undefined) {
      if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0)
        throw new Error(`${where}.data names LIMA files of ${files}, each under the name templates read it by`)
      for (const [key, file] of Object.entries(data)) {
        if (!DATA_NAME.test(key)) throw new Error(`${where}.data: ${key} is named with lower-case letters and digits`)
        if (!text(file) || !DATA_FILE.test(file))
          throw new Error(`${where}.data.${key} is the name of a LIMA file of ${files}, such as facts.lima`)
        dataFiles[key] = `${folder === '' ? '' : `${folder}/`}${file}`
      }
    }
    const fields: Record<string, Record<string, unknown>> = {}
    for (const [page, entry] of Object.entries((pages ?? {}) as Record<string, unknown>)) {
      if (!PAGE.test(page)) throw new Error(`${where}.pages: ${page} is not the name of a file of ${files}`)
      if (entry !== null && (typeof entry !== 'object' || Array.isArray(entry)))
        throw new Error(`${where}.pages.${page} is a block of front matter fields`)
      fields[`${name}-${page}`] = { urlPath: `${urlPath}${page}/`, ...(entry ?? {}) }
    }
    const home = checkout?.startsWith('~/') ? join(homedir(), checkout.slice(2)) : checkout
    return {
      name,
      repository,
      ref,
      checkout: home === undefined ? undefined : isAbsolute(home) ? home : resolve(siteDir, home),
      frozen: frozen === true,
      path: folder,
      root: pages === undefined ? undefined : (root as Root),
      pages: fields,
      data: dataFiles,
    }
  })
  const givenBy = new Map<string, string>()
  for (const source of list) {
    for (const key of Object.keys(source.data)) {
      const first = givenBy.get(key)
      if (first !== undefined)
        throw new Error(`config.lima: sources.${first} and sources.${source.name} both give data ${key}`)
      givenBy.set(key, source.name)
    }
  }
  return list
}

function git(repository: string, args: string[], what: string): Buffer {
  const run = spawnSync('git', ['-C', repository, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: FILE_BYTES })
  if (run.error && 'code' in run.error && run.error.code === 'ENOBUFS')
    throw new Error(`${what}: larger than ${FILE_BYTES / 1024 / 1024} MiB`)
  if (run.status !== 0) throw new Error(`${what}: ${run.error?.message ?? run.stderr.toString().trim()}`)
  return run.stdout
}

/** The commit `source.ref` names, in `repository`: the clone of `checkout`, or one fetched into the cache. */
function commitOf(source: Source, repository: string, fetched: boolean): string {
  const local = spawnSync(
    'git',
    ['-C', repository, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${source.ref}^{commit}`],
    { timeout: GIT_TIMEOUT_MS },
  )
  if (local.status === 0) return local.stdout.toString().trim()
  const where = `config.lima: sources.${source.name}`
  if (!fetched) throw new Error(`${where}.ref: ${source.checkout} has no commit ${source.ref}`)
  git(repository, ['fetch', '--quiet', '--depth', '1', '--', source.repository, source.ref], `${where}: git fetch`)
  return git(repository, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], `${where}: git rev-parse`).toString().trim()
}

/** The file of the page `id` in the repository: `docs/config.md` for `docs-config` of a source in docs/. */
function pageFile(source: Source, id: string): string {
  return `${source.path === '' ? '' : `${source.path}/`}${id.slice(source.name.length + 1)}.md`
}

/**
 * How many commits of what is checked out at `checkout` change one of the source's pages or data files after `ref`, as
 * a warning; undefined without such a commit or a checkout on this machine (docs/sources.md, "Falling behind").
 */
export function fallingBehind(source: Source): string | undefined {
  // a build from the cache needs no checkout, and then has nothing to compare with
  if (source.frozen || source.checkout === undefined || !existsSync(source.checkout)) return undefined
  const where = `config.lima: sources.${source.name}`
  const files = [...Object.keys(source.pages).map((id) => pageFile(source, id)), ...Object.values(source.data)]
  const count = Number(
    git(
      source.checkout,
      ['rev-list', '--count', '--end-of-options', `${source.ref}..HEAD`, '--', ...files],
      `${where}: git rev-list`,
    )
      .toString()
      .trim(),
  )
  if (count === 0) return undefined
  return `sources.${source.name}: ${count} newer commit${count === 1 ? '' : 's'} in ${source.checkout} change${count === 1 ? 's' : ''} its files after ${source.ref}`
}

/** Lines of `text`, each with whether it lies in a fenced code block (fences included). */
function linesWithFences(text: string): { line: string; code: boolean }[] {
  let fence: string | undefined
  return text.split('\n').map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence === undefined && marker) {
      fence = marker
      return { line, code: true }
    }
    if (fence !== undefined) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1]
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined
      return { line, code: true }
    }
    return { line, code: false }
  })
}

/**
 * The span of a link's destination that begins after its `](` at `start`: in angle brackets, or up to whitespace or the
 * `)` that closes the link, its own parentheses balanced, as CommonMark reads it.
 */
function destinationAt(line: string, start: number): { from: number; to: number } | undefined {
  let at = start
  while (line[at] === ' ') at++
  if (line[at] === '<') {
    const end = line.indexOf('>', at + 1)
    return end === -1 ? undefined : { from: at + 1, to: end }
  }
  let depth = 0
  let end = at
  for (; end < line.length; end++) {
    const char = line[end]!
    if (char === '\\') end++
    else if (char === '(') depth++
    else if (char === ')') {
      if (depth === 0) break
      depth--
    } else if (char === ' ' || char === '\t') break
  }
  return end > at ? { from: at, to: end } : undefined
}

/** `text` with the destinations of its links and pictures outside code passed through `target`. */
export function relink(text: string, target: (href: string) => string): string {
  return linesWithFences(text)
    .map(({ line, code }) => {
      if (code) return line
      let out = ''
      let at = 0
      while (at < line.length) {
        if (line[at] === '`') {
          // a code span closes at the next run of as many backticks; without one, the run is text
          const run = /^`+/.exec(line.slice(at))![0]
          const close = line.indexOf(run, at + run.length)
          const end = close === -1 ? at + run.length : close + run.length
          out += line.slice(at, end)
          at = end
          continue
        }
        if (line.startsWith('](', at)) {
          const destination = destinationAt(line, at + 2)
          if (destination) {
            out += line.slice(at, destination.from) + target(line.slice(destination.from, destination.to))
            at = destination.to
            continue
          }
        }
        out += line[at]
        at++
      }
      return out
    })
    .join('\n')
}

/** A link of a page of a source as the site has it, or what is wrong with it. */
export type SiteLink = { href: string } | { problem: string }

/**
 * Where a link of the page `file` (its path in the repository) leads on the site: another page of the source by its id,
 * a picture of the source's folder into the bundle (named to `picture`), any other file of the repository on GitHub. A
 * link that leaves the repository, a picture outside the folder, and a path with a backslash are problems. A query and
 * an anchor stay with it.
 */
export function siteHref(source: Source, file: string, href: string, picture: (path: string) => void): SiteLink {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return { href }
  const cut = href.search(/[?#]/)
  const path = cut === -1 ? href : href.slice(0, cut)
  const rest = cut === -1 ? '' : href.slice(cut)
  // a picture is written under the last segment of its path, which on Windows a backslash would not be
  if (path.includes('\\')) return { problem: `the link ${href} holds a backslash, which Windows reads as a separator` }
  const inRepository = posix.normalize(posix.join(posix.dirname(file), path))
  if (inRepository === '..' || inRepository.startsWith('../'))
    return { problem: `the link ${href} leaves the repository ${source.repository}` }
  const prefix = source.path === '' ? '' : `${source.path}/`
  const name = inRepository.startsWith(prefix) ? inRepository.slice(prefix.length) : undefined
  const page = name?.endsWith('.md') ? `${source.name}-${name.slice(0, -'.md'.length)}` : undefined
  if (page !== undefined && Object.hasOwn(source.pages, page)) return { href: `$${page}${rest}` }
  if (PICTURE.test(inRepository)) {
    if (name === undefined) return { problem: `the picture ${href} is not in ${prefix} of ${source.repository}` }
    picture(inRepository)
    return { href: `${posix.basename(inRepository)}${rest}` }
  }
  return { href: `${source.repository}/blob/${source.ref}/${inRepository}${rest}` }
}

/**
 * The files of a source's bundles and its data files (data/<name>.lima), by their path below the cache's folder of the
 * source, and what is wrong with the bundles' links.
 */
export function bundlesOf(
  source: Source,
  read: (path: string) => Buffer,
): { files: Map<string, Buffer>; problems: Record<string, string[]> } {
  const files = new Map<string, Buffer>()
  const problems: Record<string, string[]> = {}
  let bytes = 0
  const take = (path: string) => {
    const blob = read(path)
    bytes += blob.length
    if (bytes > SOURCE_BYTES)
      throw new Error(
        `config.lima: sources.${source.name}: its files are larger than ${SOURCE_BYTES / 1024 / 1024} MiB`,
      )
    return blob
  }
  for (const id of Object.keys(source.pages)) {
    const file = pageFile(source, id)
    const pictures = new Set<string>()
    const text = relink(take(file).toString('utf8'), (href) => {
      const link = siteHref(source, file, href, (path) => pictures.add(path))
      if ('href' in link) return link.href
      ;(problems[id] ??= []).push(link.problem)
      return href
    })
    files.set(`${source.root!}/[${id}]/${id}.md`, Buffer.from(text))
    for (const path of pictures) {
      const target = `${source.root!}/[${id}]/${posix.basename(path)}`
      if (files.has(target)) throw new Error(`${source.repository} ${file}: two pictures named ${posix.basename(path)}`)
      files.set(target, take(path))
    }
  }
  for (const [key, path] of Object.entries(source.data)) files.set(`data/${key}.lima`, take(path))
  return { files, problems }
}

/**
 * The folder the build reads a source's bundles and data from, below .hadley/cache/sources/<source>/, and what is wrong
 * with the bundles' links: made when what makes them changed (its repository, ref, checkout, folder, root, the names of
 * its pages or its data), else read as it is.
 */
export function sourceFiles(source: Source, siteDir: string): SourceFiles {
  const base = join(siteDir, '.hadley', 'cache', 'sources', source.name)
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        source.repository,
        source.ref,
        source.checkout ?? null,
        source.path,
        source.root ?? null,
        Object.keys(source.pages),
        source.data,
      ]),
    )
    .digest('hex')
    .slice(0, 16)
  const dir = join(base, key)
  if (existsSync(join(dir, '.complete')))
    return { dir, problems: JSON.parse(readFileSync(join(dir, '.problems.json'), 'utf8')) as SourceFiles['problems'] }

  const fetched = source.checkout === undefined
  const repository = source.checkout ?? join(base, 'repository')
  if (fetched && !existsSync(repository)) {
    mkdirSync(repository, { recursive: true })
    git(repository, ['init', '--quiet'], `config.lima: sources.${source.name}: git init`)
  } else if (!fetched && !existsSync(repository)) {
    throw new Error(`config.lima: sources.${source.name}.checkout: there is no ${repository}`)
  }
  const commit = commitOf(source, repository, fetched)
  // cat-file reads the bytes as they are committed: no filter, no textconv of the repository's own configuration
  const { files, problems } = bundlesOf(source, (path) =>
    git(repository, ['cat-file', 'blob', `${commit}:${path}`], `${source.repository} at ${source.ref}: ${path}`),
  )

  // made beside, then moved in whole; the folders of earlier keys go
  const made = `${dir}.new`
  rmSync(made, { recursive: true, force: true })
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(made, path)), { recursive: true })
    writeFileSync(join(made, path), bytes)
  }
  writeFileSync(join(made, '.problems.json'), JSON.stringify(problems))
  writeFileSync(join(made, '.complete'), `${source.repository} ${source.ref} ${commit}\n`)
  for (const entry of readdirSync(base)) {
    if (entry !== 'repository' && entry !== `${key}.new`) rmSync(join(base, entry), { recursive: true, force: true })
  }
  renameSync(made, dir)
  return { dir, problems }
}

/** The values of a source's data file `name`, read from its folder in the cache as LIMA Core in strict mode. */
export function readSourceData(source: Source, name: string, file: string, dir: string): unknown {
  const text = readFileSync(join(dir, 'data', `${name}.lima`), 'utf8')
  try {
    return parseCore(text, { strict: true })
  } catch (error) {
    throw new Error(
      `config.lima: sources.${source.name}.data.${name}: ${file} at ${source.ref} is no LIMA: ${(error as Error).message}`,
    )
  }
}
