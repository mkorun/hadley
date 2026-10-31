import { readFileSync } from 'node:fs'
import { join, sep as separator } from 'node:path'

const isTTY = process.stdout.isTTY ?? false

/** The options that make every command verbose, wherever they stand on its line (docs/cli.md). */
const VERBOSE = new Set(['--verbose', '-v'])

export const isVerbose = process.argv.some((arg) => VERBOSE.has(arg)) || !!process.env.DEBUG

/** A command's arguments without the verbose options, which the logger has read already. */
export const withoutVerbose = (args: readonly string[]): string[] => args.filter((arg) => !VERBOSE.has(arg))

// ANSI colour codes — only applied when writing to a real terminal
const c = isTTY
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      bGreen: '\x1b[92m', // bright green  — ✓ checkmark
      bYellow: '\x1b[93m', // bright yellow — total time
      bCyan: '\x1b[96m', // bright cyan   — brand name
      green: '\x1b[32m', // green         — build mode
      magenta: '\x1b[35m', // magenta       — publish mode
      red: '\x1b[91m', // bright red    — errors
      gray: '\x1b[90m', // dark gray     — verbose items
      cyan: '\x1b[36m', // cyan          — detail text
    }
  : (Object.fromEntries(
      ['reset', 'bold', 'dim', 'bGreen', 'bYellow', 'bCyan', 'green', 'magenta', 'red', 'gray', 'cyan'].map((k) => [
        k,
        '',
      ]),
    ) as Record<string, string>)

const SEP_WIDTH = 54
const sep = () => c.dim + '─'.repeat(SEP_WIDTH) + c.reset

export const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)

/** Clears what a terminal shows and keeps its history, which `console.clear()` erases too on Bun. */
export function clearScreen(out: { isTTY?: boolean; write(text: string): unknown } = process.stdout): void {
  if (out.isTTY) out.write('\x1b[H\x1b[J')
}

let buildStart = 0
// the step under way, which a failure marks
let running: { label: string; t0: number } | undefined

// a line of a failure that names a file of the site: `content/…/a.md: what is wrong`, `theme/…/a.chase:12: …`
const FILE_LINE = /^(\S[^:]*\.(?:md|lima|chase|sort|json|css|ts|js|png|jpe?g|webp|avif|gif|svg)(?::\d+){0,2}): (.+)$/
// galley's: `[galley:G2001] theme/…/a.chase:36:67 (line 36, col 67): what is wrong`, its lines of source after it
const GALLEY_LINE = /^\[galley:(G\d+)\] (\S+:\d+:\d+) \(line \d+, col \d+\): (.+)$/

/** The line `file:line` names in the site, as it is written there; none for a file it cannot read. */
function sourceLine(siteDir: string | undefined, place: string): string | undefined {
  const at = /^(.+?):(\d+)(?::\d+)?$/.exec(place)
  if (!siteDir || !at) return undefined
  try {
    const text = readFileSync(join(siteDir, at[1]!), 'utf-8').split('\n')[Number(at[2]) - 1]
    return text === undefined || text.trim() === '' ? undefined : `${at[2]} │ ${text.trimEnd()}`
  } catch {
    return undefined
  }
}

/**
 * A failure as a reader takes it in: the paths of the site relative to it, the lines about one place under its name
 * and, for a line of a file, that line as it is written; a heading (`cannot publish:`) on its own; the stack only with
 * --verbose.
 */
export function failureText(error: unknown, siteDir?: string): string {
  let message = error instanceof Error ? error.message : String(error)
  // a path hadley wrote with / and one the file system gave with its own separator
  if (siteDir)
    for (const end of new Set(['/', separator])) message = message.split(siteDir.replace(/[\\/]+$/, '') + end).join('')
  const out: string[] = ['']
  let file: string | undefined
  let source = false // the lines of source a galley line brings
  // the line the place names, written once the messages about it are
  let quoted: string | undefined
  const quote = () => {
    if (quoted !== undefined) out.push(`     ${c.dim}${quoted}${c.reset}`)
    quoted = undefined
  }
  for (const line of message.split('\n')) {
    const galley = GALLEY_LINE.exec(line)
    if (galley) {
      quote()
      out.push(`  ${c.bold}${galley[2]}${c.reset}`, `     ${galley[3]} ${c.dim}(${galley[1]})${c.reset}`)
      file = undefined
      source = true
      continue
    }
    if (source && line.trim() !== '') {
      out.push(`  ${c.dim}${line}${c.reset}`)
      continue
    }
    source = false
    const named = FILE_LINE.exec(line)
    if (named) {
      if (named[1] !== file) {
        quote()
        out.push(`  ${c.bold}${named[1]}${c.reset}`)
        quoted = sourceLine(siteDir, named[1]!)
      }
      file = named[1]
      out.push(`     ${named[2]}`)
      continue
    }
    quote()
    file = undefined
    if (/^\S.*:$/.test(line)) out.push(`  ${c.bold}${c.red}${line.slice(0, -1)}${c.reset}`, '')
    else out.push(`  ${line}`)
  }
  quote()
  if (isVerbose && error instanceof Error && error.stack) out.push('', c.gray + error.stack + c.reset)
  return out.join('\n') + '\n'
}

export const logger = {
  header(mode: 'dev' | 'publish') {
    buildStart = performance.now()
    const modeStr = mode === 'publish' ? `${c.bold}${c.magenta}publish${c.reset}` : `${c.bold}${c.green}dev${c.reset}`
    const title = `  ${c.bold}${c.bCyan}hadley${c.reset} ${c.dim}—${c.reset} ${modeStr}`
    process.stdout.write(`\n${sep()}\n${title}\n${sep()}\n`)
  },

  /**
   * Call at step start — returns a done() function to call on completion.
   *
   * const done = logger.step('render pages')
   * // ... work ...
   * done('8 pages → .hadley/dev/')
   */
  step(label: string) {
    const t0 = performance.now()
    running = { label, t0 }
    if (isTTY) {
      // Show a dim dot while the step is running — overwritten on done()
      process.stdout.write(`  ${c.dim}·  ${label}${c.reset}`)
    }
    return (detail?: string, warns?: string[]) => {
      running = undefined
      const ms = performance.now() - t0
      const time = c.dim + formatMs(ms).padStart(8) + c.reset
      const info = detail ? `  ${c.dim}${c.cyan}${detail}${c.reset}` : ''
      const warnInfo = warns?.length ? `  ${c.bold}${c.bYellow}· ${warns.length} ⚠${c.reset}` : ''
      const row = `  ${c.bGreen}✓${c.reset}  ${label.padEnd(24)}${time}${info}${warnInfo}\n`
      if (isTTY) {
        process.stdout.write('\r' + row)
      } else {
        process.stdout.write(row)
      }
      if (warns?.length && isVerbose) {
        for (const w of warns) {
          process.stdout.write(`       ${c.gray}⚠  ${w}${c.reset}\n`)
        }
      }
    }
  },

  /** Per-item detail lines shown only when --verbose / -v / DEBUG=1 */
  verbose(items: string[]) {
    if (!isVerbose) return
    for (const item of items) {
      process.stdout.write(`       ${c.gray}${item}${c.reset}\n`)
    }
  },

  footer() {
    const total = performance.now() - buildStart
    const now = new Date()
    const ts = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    process.stdout.write(
      `${sep()}\n  ${c.bold}done${c.reset} in ${c.bold}${c.bYellow}${formatMs(total)}${c.reset}${c.dim} · ${ts}${c.reset}\n\n`,
    )
  },

  warn(msg: string) {
    process.stderr.write(`  ${c.bold}${c.bYellow}⚠${c.reset}  ${c.dim}${msg}${c.reset}\n`)
  },

  error(msg: string) {
    process.stderr.write(`  ${c.bold}${c.red}✗${c.reset}  ${msg}\n`)
  },

  /** A build that stopped: the step under way marked, then the failure (failureText). */
  failed(error: unknown, siteDir?: string) {
    if (running) {
      const time = c.dim + formatMs(performance.now() - running.t0).padStart(8) + c.reset
      process.stdout.write(`${isTTY ? '\r' : ''}  ${c.red}×${c.reset}  ${running.label.padEnd(24)}${time}\n`)
      running = undefined
    }
    process.stderr.write(failureText(error, siteDir))
  },
}
