/**
 * The versions of a page, the editor's time machine (docs/dev-server.md, "Versions"): every state of a page's Markdown
 * file the dev server sees, whoever wrote it (the editor, an agent of the chat, another program), so that the author
 * can compare an earlier one with the page and go back to it. In the site's `.hadley/history/`, never in its
 * repository: each state once, as `objects/<sha256>`, and for each page a log, `pages/<sha256 of its path>.jsonl`, a
 * line for each version. The last KEEP unnamed versions of a page stay, and every named one. No Git: the same on every
 * system, without anything to install (Michael, 2026-11-09). Spec: private/docs/SPEC_hadley-versions.md.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { slashed } from '../../lib/platform.ts'

export type By = 'editor' | 'agent' | 'outside' | 'restore'
export type What = 'edit' | 'move' | 'merge' | 'delete' | 'new' | 'picture'
export interface Version {
  at: number
  hash: string
  by: By
  what?: What
  // the agent that was working when the page changed (by: agent)
  agent?: string
  name?: string
  // the version the page stood at when this one was made, by its time: undo goes back to it (steps)
  after?: number
  // the version a restore brought back, by its time (by: restore): the card names it
  from?: number
}

/** How many unnamed versions of a page stay (Michael, 2026-11-09: 100, back and forth). */
export const KEEP = 100
export const NAME_MAX = 80
const HASH = /^[0-9a-f]{64}$/
const BY: readonly By[] = ['editor', 'agent', 'outside', 'restore']
const WHAT: readonly What[] = ['edit', 'move', 'merge', 'delete', 'new', 'picture']

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A line of a log as it was written, or undefined where it is not one: a log is read, never trusted. */
function versionOf(line: string): Version | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const { at, hash, by, what, agent, name, after, from } = record
  if (typeof at !== 'number' || typeof hash !== 'string' || !HASH.test(hash) || !BY.includes(by as By)) return undefined
  return {
    at,
    hash,
    by: by as By,
    ...(WHAT.includes(what as What) ? { what: what as What } : {}),
    ...(typeof agent === 'string' && agent.length <= 64 ? { agent } : {}),
    ...(typeof name === 'string' && name.trim() && name.length <= NAME_MAX ? { name } : {}),
    // made on an older one, or on none it names: a version made on itself or a later one would never end a walk down
    // the chain (review 2026-11-09: a log edited by hand hung the server)
    ...(typeof after === 'number' && after < at ? { after } : {}),
    ...(typeof from === 'number' ? { from } : {}),
  }
}

/** A change undo or redo would take: the version that made it, and the version the page goes to. */
export interface Step {
  change: Version
  target: Version
}

/** The version a version was made on: the one it names, else, in an older log, the one before it. */
function parentOf(versions: readonly Version[], index: number): Version | undefined {
  const version = versions[index]
  if (!version) return undefined
  // one it names that is gone (a log from before relinking) falls back to the one before it
  return (version.after !== undefined && versions.find((v) => v.at === version.after)) || versions[index - 1]
}

/**
 * The versions without those in `drop`, each that was made on one of them made on the nearest one kept below it now,
 * so that deleting or pruning never breaks the chain undo walks (Michael, 2026-11-09: a version deleted in between
 * made all below it look undone).
 */
export function without(versions: readonly Version[], drop: ReadonlySet<Version>): Version[] {
  return versions.flatMap((version, index) => {
    if (drop.has(version)) return []
    let parent = parentOf(versions, index)
    if (!parent || !drop.has(parent)) return [version]
    // each parent once: a chain that came round again ends (load() keeps none, this holds without it too)
    const seen = new Set<Version>()
    while (parent && drop.has(parent) && !seen.has(parent)) {
      seen.add(parent)
      parent = parentOf(versions, versions.indexOf(parent))
    }
    if (parent && drop.has(parent)) parent = undefined
    const { after: _gone, ...rest } = version
    return [parent ? { ...rest, after: parent.at } : rest]
  })
}

/**
 * The versions undo took the page away from: all but the one it stands at and those it was made on, back to the
 * first; the versions card shows them as undone (Michael, 2026-11-09). By their time.
 */
export function undone(versions: readonly Version[], at: number): Set<number> {
  const path = new Set<Version>()
  let index = versions.findIndex((v) => v.at === at)
  while (index !== -1 && !path.has(versions[index]!)) {
    path.add(versions[index]!)
    const parent = parentOf(versions, index)
    index = parent ? versions.indexOf(parent) : -1
  }
  return new Set(versions.filter((v) => !path.has(v)).map((v) => v.at))
}

/**
 * Where undo and redo lead from the version the page stands at (Michael, 2026-11-09: back and forth, the agent's
 * changes too, and no version for a step): the versions as a tree, each made on the one it names. Undo takes back the
 * change the page stands at and goes to the version it was made on; redo goes to the newest version made on the one
 * the page stands at. Undo and redo only move the page among the versions, they make none.
 */
export function steps(versions: readonly Version[], at: number): { undo?: Step; redo?: Step } {
  const index = versions.findIndex((v) => v.at === at)
  const here = versions[index]
  if (!here) return {}
  const back = parentOf(versions, index)
  const forth = versions.findLast((_, i) => parentOf(versions, i) === here)
  return {
    ...(back ? { undo: { change: here, target: back } } : {}),
    ...(forth ? { redo: { change: forth, target: forth } } : {}),
  }
}

/** The unnamed versions beyond KEEP go, oldest first; the newest and the one the page stands at always stay. */
export function pruned(versions: readonly Version[], at?: number): { kept: Version[]; dropped: Version[] } {
  let unnamed = versions.filter((version) => version.name === undefined).length
  const kept: Version[] = []
  const dropped: Version[] = []
  versions.forEach((version, index) => {
    if (version.name === undefined && unnamed > KEEP && index < versions.length - 1 && version.at !== at) {
      dropped.push(version)
      unnamed -= 1
    } else kept.push(version)
  })
  return { kept: without(versions, new Set(dropped)), dropped }
}

export interface History {
  /**
   * Keeps `content` as the newest version of `file`, made on the version the page stands at, unless it is that one
   * already; the version it made, if any. The page then stands at it.
   */
  record(
    file: string,
    content: string,
    by: By,
    more?: { what?: What; agent?: string; from?: number },
  ): Promise<Version | undefined>
  /** The versions of `file`, newest first. */
  list(file: string): Promise<Version[]>
  /** The text of a version of `file`: only a hash its log names. */
  content(file: string, hash: string): Promise<string | undefined>
  /**
   * Names the version of `file` made at `at` with `hash` (without `at`, the newest with `hash`), or takes its name
   * with ''; false where there is none.
   */
  name(file: string, hash: string, name: string, at?: number): Promise<boolean>
  /**
   * Deletes the version of `file` made at `at` with `hash`, never the one the page stands at; false
   * where none.
   */
  remove(file: string, at: number, hash: string): Promise<boolean>
  /** Deletes every unnamed version of `file` but the one the page stands at; how many went. */
  removeUnnamed(file: string): Promise<number>
  /** Where undo and redo lead from the version the page stands at (steps). */
  steps(file: string): Promise<{ undo?: Step; redo?: Step }>
  /** The time of the version the page of `file` stands at: the newest, unless undo or redo moved it. */
  standing(file: string): Promise<number | undefined>
  /** The page of `file` stands at the version made at `at` now: undo or redo wrote it. */
  stand(file: string, at: number): Promise<void>
}

export function history(root: string): History {
  const dir = join(root, '.hadley', 'history')
  const objects = join(dir, 'objects')
  const pages = join(dir, 'pages')
  const logs = new Map<string, Version[]>()
  // where undo and redo left each page, by the time of its version; while the dev server runs, else the newest
  const stands = new Map<string, number>()
  const standingAt = (path: string, versions: readonly Version[]): Version | undefined =>
    versions.find((v) => v.at === stands.get(path)) ?? versions.at(-1)
  // one change after another: a log is read, changed and written whole
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work)
    queue = run.catch(() => undefined)
    return run
  }

  /** The page's path in the site, or an error for a file outside it. */
  const pathOf = (file: string): string => {
    const path = relative(root, file)
    if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..'))
      throw new Error('history: a file outside the site')
    return slashed(path)
  }
  const logOf = (path: string): string => join(pages, `${sha256(path)}.jsonl`)

  /** Written beside, then renamed: a log or an object is never half written. */
  async function replace(target: string, text: string): Promise<void> {
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(temp, text, 'utf-8')
    await rename(temp, target)
  }

  async function load(path: string): Promise<Version[]> {
    const cached = logs.get(path)
    if (cached) return cached
    const text = await readFile(logOf(path), 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    // in the order of their time, as they are written: one out of it is left out, so that the one before a version is
    // older too
    const versions: Version[] = []
    for (const line of text.split('\n')) {
      const version = versionOf(line)
      if (version && (versions.length === 0 || version.at > versions.at(-1)!.at)) versions.push(version)
    }
    logs.set(path, versions)
    return versions
  }

  async function save(path: string, versions: Version[]): Promise<void> {
    await mkdir(pages, { recursive: true })
    await replace(logOf(path), versions.map((version) => JSON.stringify({ ...version, file: path }) + '\n').join(''))
    logs.set(path, versions)
  }

  /** The objects of `dropped` that no log names any more go. */
  async function collect(dropped: readonly Version[]): Promise<void> {
    if (dropped.length === 0) return
    const named = new Set<string>()
    for (const entry of await readdir(pages).catch(() => [] as string[])) {
      if (!entry.endsWith('.jsonl')) continue
      const text = await readFile(join(pages, entry), 'utf-8').catch(() => '')
      for (const line of text.split('\n')) {
        const version = versionOf(line)
        if (version) named.add(version.hash)
      }
    }
    for (const { hash } of dropped) if (!named.has(hash)) await rm(join(objects, hash), { force: true })
  }

  return {
    record(file, content, by, more = {}) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const hash = sha256(content)
        const here = standingAt(path, versions)
        if (here?.hash === hash) return undefined
        await mkdir(objects, { recursive: true })
        const object = join(objects, hash)
        if ((await readFile(object, 'utf-8').catch(() => undefined)) !== content) await replace(object, content)
        const version: Version = {
          // strictly later than the one before: a version is named by its time and its hash
          at: Math.max(Date.now(), (versions.at(-1)?.at ?? 0) + 1),
          hash,
          by,
          ...(more.what ? { what: more.what } : {}),
          ...(more.agent ? { agent: more.agent.slice(0, 64) } : {}),
          ...(here ? { after: here.at } : {}),
          ...(more.from === undefined ? {} : { from: more.from }),
        }
        stands.set(path, version.at)
        const { kept, dropped } = pruned([...versions, version], version.at)
        await save(path, kept)
        await collect(dropped)
        return version
      })
    },
    list(file) {
      return serial(async () => [...(await load(pathOf(file)))].reverse())
    },
    content(file, hash) {
      return serial(async () => {
        if (!HASH.test(hash)) return undefined
        if (!(await load(pathOf(file))).some((version) => version.hash === hash)) return undefined
        return readFile(join(objects, hash), 'utf-8').catch(() => undefined)
      })
    },
    name(file, hash, name, at) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const index = versions.findLastIndex(
          (version) => version.hash === hash && (at === undefined || version.at === at),
        )
        if (index === -1) return false
        const { name: _old, ...rest } = versions[index]!
        const changed = [...versions]
        changed[index] = name.trim() ? { ...rest, name: name.trim().slice(0, NAME_MAX) } : rest
        const { kept, dropped } = pruned(changed, standingAt(path, versions)?.at)
        await save(path, kept)
        await collect(dropped)
        return true
      })
    },
    remove(file, at, hash) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const index = versions.findIndex((version) => version.at === at && version.hash === hash)
        // the page as it is stays; the newest only while the page stands at it
        if (index === -1 || versions[index] === standingAt(path, versions)) return false
        const dropped = versions[index]!
        await save(path, without(versions, new Set([dropped])))
        await collect([dropped])
        return true
      })
    },
    steps(file) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const here = standingAt(path, versions)
        return here ? steps(versions, here.at) : {}
      })
    },
    standing(file) {
      return serial(async () => {
        const path = pathOf(file)
        return standingAt(path, await load(path))?.at
      })
    },
    stand(file, at) {
      return serial(async () => {
        const path = pathOf(file)
        if ((await load(path)).some((v) => v.at === at)) stands.set(path, at)
      })
    },
    removeUnnamed(file) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const here = standingAt(path, versions)
        const dropped = versions.filter((version) => version.name === undefined && version !== here)
        if (dropped.length === 0) return 0
        await save(path, without(versions, new Set(dropped)))
        await collect(dropped)
        return dropped.length
      })
    },
  }
}

// the dev server's history, and what tells whether an agent is working (lib/dev-server.ts)
let current: History | undefined
let working: () => string | undefined = () => undefined

/** Starts the history of the site the dev server serves; `agent` names the agent of the chat while it works. */
export function startHistory(root: string, agent?: () => string | undefined): void {
  current = history(root)
  site = root
  if (agent) working = agent
}

// the site the dev server serves, whose `.hadley/` holds the history and the files the editor took away (trash.ts)
let site: string | undefined
export const siteRoot = (): string | undefined => site

export const siteHistory = (): History | undefined => current

/**
 * A page the build read: kept if it changed since its newest version, by an agent if one was working (a guess, and
 * the panel says it as one), else from outside. What the editor wrote it kept itself, with what it did.
 */
export function seen(file: string, content: string): void {
  const agent = working()
  void current?.record(file, content, agent ? 'agent' : 'outside', agent ? { agent } : {}).catch(() => undefined)
}
