/**
 * An agent the dev server starts itself, in the background, for the chat (docs/dev-server.md, "Chat"): Claude Code or
 * Codex, the user's own program with the user's own login, in the site's directory. It reads the author's messages one
 * after another; what it answers goes to the panel as a reply, or as the proposal of a rewrite; each request to write,
 * run or reach out waits for Allow or Deny in the panel. The way through a channel (channel.ts) stays beside it; a dev
 * server has one agent at a time (plugin.ts). Spec: private/docs/SPEC_hadley-chat-agents.md.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { isProgram, onPath } from '../../lib/platform.ts'
import { actionContent, MAX_BYTES, type Message, type Permission } from './protocol.ts'
import { claude } from './agents/claude.ts'
import { codex } from './agents/codex.ts'

export type AgentName = 'claude' | 'codex'
export const AGENTS: Record<AgentName, string> = { claude: 'Claude Code', codex: 'Codex' }
export const isAgentName = (value: unknown): value is AgentName => value === 'claude' || value === 'codex'

/**
 * The programs of the agents there are: `dev.claude` and `dev.codex` of the user configuration, else `claude` and
 * `codex` on the PATH. A configured one that is no program stops, as `dev.forms` does.
 */
export function agentPrograms(
  configured: Partial<Record<AgentName, string>>,
  path = process.env.PATH ?? '',
): Partial<Record<AgentName, string>> {
  const found: Partial<Record<AgentName, string>> = {}
  for (const name of Object.keys(AGENTS) as AgentName[]) {
    const own = configured[name]
    if (own !== undefined && !isProgram(own)) throw new Error(`dev.${name}: ${own} is no program that can be run`)
    const program = own ?? onPath(name, path)
    if (program) found[name] = program
  }
  return found
}

export type Write = (value: unknown) => void
export interface AdapterEvents {
  session(id: string): void
  answer(text: string): void
  permission(ref: string, request: Omit<Permission, 'request_id'>): void
  resumeFailed(): void
}
/** One agent's way of talking: its arguments, and what goes in and comes out, a JSON value on each line. */
export interface Adapter {
  args(session?: string): string[]
  open(write: Write, session?: string): void
  send(text: string): void
  answer(ref: string, allow: boolean): void
  read(event: unknown, on: AdapterEvents): void
}

export type Notice = 'resumed' | 'resumeFailed' | 'begun' | 'stopped' | 'crashed' | 'startFailed' | 'deniedInAction'

export interface Hooks {
  delivered(id: string): void
  answer(id: string, text: string, action: boolean): void
  permission(request: Permission): void
  notice(kind: Notice, code?: string): void
  ended(): void
}

export const INSTRUCTIONS = [
  'Messages come from the site author in the hadley block editor, each in a <hadley …> element: site is the production',
  'origin, root the absolute directory the dev server serves, url the page the author is reading, file and lines the',
  "block the author is on, relative to root, and lang the author's language. Work in root and nowhere else. Answer in",
  "the author's language; the author reads your answer in a panel beside the page. Re-read a file before changing it:",
  'the author edits it in the editor at the same time.',
  'A message with an action asks for a rewrite: take no detour, read no file and use no tool. Answer with the',
  'replacement text and nothing else: no quotes, explanation or Markdown fence around it. Keep the original language and',
  'Markanto markup. With direction fix change nothing but errors. An instruction adds to the direction; with direction',
  'custom it is all there is. You propose; only the editor writes.',
  "The author allows or denies each request to use a tool. A denied request is the author's decision: do not retry it,",
  'and do not reach the same result another way. Say what was denied, and stop.',
].join(' ')

/** A message as the agent reads it: where it comes from in a head, then the text or the action. */
export function agentContent(message: Message, lang: string): string {
  const fields: [string, string | undefined][] = [
    ['site', message.site],
    ['root', message.root],
    ['url', message.url],
    ['file', message.file],
    ['lines', message.lines],
    ['lang', lang],
    ['action', message.action],
  ]
  const head = fields.flatMap(([key, value]) => (value === undefined ? [] : [`${key}=${JSON.stringify(value)}`]))
  return `<hadley ${head.join(' ')}>\n${actionContent(message)}\n</hadley>`
}

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// the panel's request ids (protocol.ts): five letters without l
const LETTERS = 'abcdefghijkmnopqrstuvwxyz'
const requestId = (): string => Array.from({ length: 5 }, () => LETTERS[randomInt(LETTERS.length)]).join('')
const clip = (value: string): string =>
  Buffer.byteLength(value) > MAX_BYTES / 4 ? value.slice(0, 64_000) + '\n…' : value

export interface Running {
  name: AgentName
  send(message: Message, lang: string, action: boolean): void
  verdict(requestId: string, allow: boolean): boolean
  stop(): Promise<void>
}

/** Where the dev server keeps the conversation it continues next time, in the site's own hadley directory. */
export const sessionFile = (root: string, name: AgentName): string => join(root, '.hadley', 'chat', name)

export function runAgent(
  options: { name: AgentName; program: string; root: string; fresh: boolean },
  hooks: Hooks,
): Running {
  const { name, program, root } = options
  const file = sessionFile(root, name)
  let saved: string | undefined
  if (!options.fresh)
    try {
      const value = readFileSync(file, 'utf8').trim()
      if (SESSION.test(value)) saved = value
    } catch {
      // none yet
    }
  const queue: { id: string; text: string; action: boolean }[] = []
  let busy: { id: string; action: boolean } | undefined
  const open = new Map<string, string>()
  let stopping = false
  let ended = false
  let exited: Promise<void> = Promise.resolve()
  let child: ReturnType<typeof spawn> | undefined
  let adapter: Adapter

  function launch(session: string | undefined): void {
    adapter = name === 'claude' ? claude(INSTRUCTIONS) : codex(INSTRUCTIONS, root)
    let known = false
    const proc = spawn(program, adapter.args(session), {
      cwd: root,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: process.env,
      windowsHide: true,
    })
    child = proc
    const write: Write = (value) => {
      if (proc.stdin?.writable) proc.stdin.write(JSON.stringify(value) + '\n')
    }
    const events: AdapterEvents = {
      session(id) {
        if (!SESSION.test(id)) return
        if (!known) {
          known = true
          if (session && id === session) hooks.notice('resumed')
        }
        try {
          mkdirSync(join(root, '.hadley', 'chat'), { recursive: true })
          writeFileSync(file, id + '\n')
        } catch {
          // the next start begins a new conversation
        }
      },
      answer(text) {
        const done = busy
        busy = undefined
        if (done) hooks.answer(done.id, text, done.action)
        pump()
      },
      permission(ref, request) {
        // a rewrite needs no tool (INSTRUCTIONS): denied before it reaches the author
        if (busy?.action) {
          adapter.answer(ref, false)
          hooks.notice('deniedInAction')
          return
        }
        let id: string
        do id = requestId()
        while (open.has(id))
        open.set(id, ref)
        hooks.permission({
          request_id: id,
          tool: request.tool.slice(0, 200) || 'Tool',
          description: request.description.slice(0, 2000) || request.tool,
          preview: clip(request.preview),
        })
      },
      resumeFailed() {
        hooks.notice('resumeFailed')
      },
    }
    let failed: string | undefined
    let buffer = ''
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        let event: unknown
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        try {
          adapter.read(event, events)
        } catch {
          // a shape the adapter does not know is passed over
        }
      }
      if (buffer.length > MAX_BYTES) {
        buffer = ''
        failed = 'output'
        proc.kill('SIGTERM')
      }
    })
    exited = new Promise<void>((resolve) => {
      proc.once('error', (error: NodeJS.ErrnoException) => {
        failed = error.code ?? 'error'
        resolve()
      })
      proc.once('exit', (code, signal) => {
        failed ??= signal ?? (code === 0 ? undefined : String(code))
        resolve()
      })
    }).then(() => {
      if (child !== proc) return
      // a conversation that could not be continued: a new one, once (Claude Code ends at once)
      if (!stopping && session && !known) {
        hooks.notice('resumeFailed')
        launch(undefined)
        return
      }
      for (const ref of open.values()) adapter.answer(ref, false)
      open.clear()
      ended = true
      if (stopping) hooks.notice('stopped')
      else if (failed === 'ENOENT' || failed === 'EACCES') hooks.notice('startFailed', failed)
      else hooks.notice('crashed', failed ?? '0')
      hooks.ended()
    })
    adapter.open(write, session)
    // what waited for a new start goes again
    if (busy) {
      queue.unshift({ ...busy, text: busyText })
      busy = undefined
    }
    pump()
  }
  let busyText = ''
  function pump(): void {
    if (busy || ended) return
    const next = queue.shift()
    if (!next) return
    busy = { id: next.id, action: next.action }
    busyText = next.text
    adapter.send(next.text)
    if (!delivered.has(next.id)) hooks.delivered(next.id)
    delivered.add(next.id)
  }
  const delivered = new Set<string>()

  launch(saved)
  // Claude Code names its session only with its first answer: a new conversation is said at once
  if (options.fresh) hooks.notice('begun')
  return {
    name,
    send(message, lang, action) {
      queue.push({ id: message.id, text: agentContent(message, lang), action })
      pump()
    },
    verdict(id, allow) {
      const ref = open.get(id)
      if (ref === undefined) return false
      open.delete(id)
      adapter.answer(ref, allow)
      return true
    },
    async stop() {
      if (ended) return
      stopping = true
      for (const ref of open.values()) adapter.answer(ref, false)
      open.clear()
      const proc = child
      proc?.stdin?.end()
      const term = setTimeout(() => proc?.kill('SIGTERM'), 3000)
      const kill = setTimeout(() => proc?.kill('SIGKILL'), 8000)
      await exited
      clearTimeout(term)
      clearTimeout(kill)
    },
  }
}
