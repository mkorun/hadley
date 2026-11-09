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

export type By = 'editor' | 'agent' | 'outside' | 'restore' | 'undo' | 'redo'
export type What = 'edit' | 'move' | 'merge' | 'delete' | 'new' | 'picture'
export interface Version {
  at: number
  hash: string
  by: By
  what?: What
  // the agent that was working when the page changed (by: agent)
  agent?: string
  name?: string
  // the version an undo or a redo went to, by its time (by: undo, redo)
  back?: number
}

/** How many unnamed versions of a page stay (Michael, 2026-11-09: 100, back and forth). */
export const KEEP = 100
export const NAME_MAX = 80
const HASH = /^[0-9a-f]{64}$/
const BY: readonly By[] = ['editor', 'agent', 'outside', 'restore', 'undo', 'redo']
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
  const { at, hash, by, what, agent, name, back } = record
  if (typeof at !== 'number' || typeof hash !== 'string' || !HASH.test(hash) || !BY.includes(by as By)) return undefined
  return {
    at,
    hash,
    by: by as By,
    ...(WHAT.includes(what as What) ? { what: what as What } : {}),
    ...(typeof agent === 'string' && agent.length <= 64 ? { agent } : {}),
    ...(typeof name === 'string' && name.trim() && name.length <= NAME_MAX ? { name } : {}),
    ...(typeof back === 'number' ? { back } : {}),
  }
}

/** A change undo or redo would take: the version that made it, and the version the page goes to. */
export interface Step {
  change: Version
  target: Version
}

/**
 * Where undo and redo lead from the page as it is (Michael, 2026-11-09: back and forth, the agent's changes too): the
 * log played as an editor's two stacks. A change (every version but an undo or a redo) goes on the undo stack and
 * empties the redo stack; an undo moves the top of the undo stack to the redo stack, a redo moves it back. Undo takes
 * back the change on top and goes to the one below it; redo brings back the top of the redo stack.
 */
export function steps(versions: readonly Version[]): { undo?: Step; redo?: Step } {
  const done: Version[] = []
  const undone: Version[] = []
  for (const version of versions) {
    if (version.by === 'undo') {
      const change = done.pop()
      if (change) undone.push(change)
    } else if (version.by === 'redo') {
      const change = undone.pop()
      if (change) done.push(change)
    } else {
      done.push(version)
      undone.length = 0
    }
  }
  const change = done.at(-1)
  const below = done.at(-2)
  const again = undone.at(-1)
  return {
    ...(change && below ? { undo: { change, target: below } } : {}),
    ...(again ? { redo: { change: again, target: again } } : {}),
  }
}

/** The unnamed versions beyond KEEP go, oldest first; the newest, the page as it is, always stays. */
export function pruned(versions: readonly Version[]): { kept: Version[]; dropped: Version[] } {
  let unnamed = versions.filter((version) => version.name === undefined).length
  const kept: Version[] = []
  const dropped: Version[] = []
  versions.forEach((version, index) => {
    if (version.name === undefined && unnamed > KEEP && index < versions.length - 1) {
      dropped.push(version)
      unnamed -= 1
    } else kept.push(version)
  })
  return { kept, dropped }
}

export interface History {
  /** Keeps `content` as the newest version of `file`, unless it is that already; the version it made, if any. */
  record(
    file: string,
    content: string,
    by: By,
    more?: { what?: What; agent?: string; back?: number },
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
  /** Deletes the version of `file` made at `at` with `hash`, never the newest (the page as it is); false where none. */
  remove(file: string, at: number, hash: string): Promise<boolean>
  /** Deletes every unnamed version of `file` but the newest; how many went. */
  removeUnnamed(file: string): Promise<number>
  /** Where undo and redo lead from `file` as its log stands (steps). */
  steps(file: string): Promise<{ undo?: Step; redo?: Step }>
}

export function history(root: string): History {
  const dir = join(root, '.hadley', 'history')
  const objects = join(dir, 'objects')
  const pages = join(dir, 'pages')
  const logs = new Map<string, Version[]>()
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
    const versions = text.split('\n').flatMap((line) => versionOf(line) ?? [])
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
        // an undo or a redo is always a version: the stacks are played from them (steps)
        if (by !== 'undo' && by !== 'redo' && versions.at(-1)?.hash === hash) return undefined
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
          ...(more.back === undefined ? {} : { back: more.back }),
        }
        const { kept, dropped } = pruned([...versions, version])
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
        const { kept, dropped } = pruned(changed)
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
        if (index === -1 || index === versions.length - 1) return false
        const dropped = versions[index]!
        await save(
          path,
          versions.filter((_, i) => i !== index),
        )
        await collect([dropped])
        return true
      })
    },
    steps(file) {
      return serial(async () => steps(await load(pathOf(file))))
    },
    removeUnnamed(file) {
      return serial(async () => {
        const path = pathOf(file)
        const versions = await load(path)
        const keep = (version: Version, i: number) => version.name !== undefined || i === versions.length - 1
        const dropped = versions.filter((version, i) => !keep(version, i))
        if (dropped.length === 0) return 0
        await save(path, versions.filter(keep))
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
  if (agent) working = agent
}

export const siteHistory = (): History | undefined => current

/**
 * A page the build read: kept if it changed since its newest version, by an agent if one was working (a guess, and
 * the panel says it as one), else from outside. What the editor wrote it kept itself, with what it did.
 */
export function seen(file: string, content: string): void {
  const agent = working()
  void current?.record(file, content, agent ? 'agent' : 'outside', agent ? { agent } : {}).catch(() => undefined)
}
