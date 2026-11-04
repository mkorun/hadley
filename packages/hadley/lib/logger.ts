import { readFileSync } from 'node:fs'
import { join, sep as separator } from 'node:path'

const isTTY = process.stdout.isTTY ?? false

/** The options that make every command verbose, wherever they stand on its line (docs/cli.md). */
const VERBOSE = new Set(['--verbose', '-v'])

export const isVerbose = process.argv.some((arg) => VERBOSE.has(arg)) || !!process.env.DEBUG

/** A command's arguments without the verbose options, which the logger has read already. */
export const withoutVerbose = (args: readonly string[]): string[] => args.filter((arg) => !VERBOSE.has(arg))

/** How a terminal takes colour (docs/cli.md): hadley's own tones in 24 bits or 256, the terminal's basic ones, none. */
export type Colours = 'truecolor' | '256' | 'basic' | 'none'

export function colours(env: Record<string, string | undefined>, tty: boolean): Colours {
  if (!tty || (env.NO_COLOR ?? '') !== '' || env.TERM === 'dumb') return 'none'
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor'
  return /256/.test(env.TERM ?? '') ? '256' : 'basic'
}

// the name and the total in bold, a step done in olive, what is said about it and a path in blue,
// times and lines in the grey of hadley.sh; red only for a failure. Text keeps the terminal's own colour.
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`
const PALETTES: Record<Colours, Record<'check' | 'muted' | 'detail' | 'warn' | 'error', string>> = {
  truecolor: {
    check: fg(135, 154, 57),
    muted: fg(141, 146, 155),
    detail: fg(126, 167, 216),
    warn: fg(229, 192, 123),
    error: fg(195, 82, 75),
  },
  '256': {
    check: '\x1b[38;5;106m',
    muted: '\x1b[38;5;245m',
    detail: '\x1b[38;5;110m',
    warn: '\x1b[38;5;180m',
    error: '\x1b[38;5;167m',
  },
  basic: { check: '\x1b[32m', muted: '\x1b[2m', detail: '\x1b[2m', warn: '\x1b[33m', error: '\x1b[91m' },
  none: { check: '', muted: '', detail: '', warn: '', error: '' },
}
const level = colours(process.env, isTTY)
const c = {
  ...PALETTES[level],
  ...(level === 'none' ? { reset: '', bold: '' } : { reset: '\x1b[0m', bold: '\x1b[1m' }),
}

/** Below this many columns a build's steps take their short names. */
const NARROW = 70
const columns = () => (isTTY ? (process.stdout.columns ?? Infinity) : Infinity)
const sep = () => c.muted + '─'.repeat(Math.min(54, columns() - 1)) + c.reset

export const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)

/** Clears what a terminal shows and keeps its history, which `console.clear()` erases too on Bun. */
export function clearScreen(out: { isTTY?: boolean; write(text: string): unknown } = process.stdout): void {
  if (out.isTTY) out.write('\x1b[H\x1b[J')
}

let buildStart = 0
// the step under way, which a failure marks
let running: { label: string; short?: string | undefined; t0: number } | undefined

/**
 * A step as the command line writes it: its mark, its name, its time and what it says about its work. Below NARROW
 * columns it takes its short name; what it says that does not fit beside it goes on the next line.
 */
export function stepRow(
  step: {
    mark: '◉' | '✕'
    label: string
    short?: string | undefined
    ms: number
    detail?: string | undefined
    warns?: number | undefined
  },
  width: number,
  paint: Record<'reset' | 'bold' | 'check' | 'error' | 'muted' | 'detail' | 'warn', string> = c,
): string {
  const narrow = width < NARROW
  const lead = narrow ? ' ' : '  '
  const gap = narrow ? ' ' : '  '
  const name = narrow ? `${step.short ?? step.label} `.padEnd(15) : step.label.padEnd(24)
  const time = formatMs(step.ms).padStart(narrow ? 6 : 8)
  const head = `${lead}${paint[step.mark === '◉' ? 'check' : 'error']}${step.mark}${paint.reset}${gap}${name}`
  const headWidth = lead.length + 1 + gap.length + name.length + time.length
  const said = [step.detail, step.warns ? `· ${step.warns} !` : undefined].filter((part) => part !== undefined)
  const saidWidth = said.join('  ').length
  const saidText = [
    ...(step.detail === undefined ? [] : [`${paint.detail}${step.detail}${paint.reset}`]),
    ...(step.warns ? [`${paint.bold}${paint.warn}· ${step.warns} !${paint.reset}`] : []),
  ].join('  ')
  const row = `${head}${paint.muted}${time}${paint.reset}`
  if (said.length === 0) return row
  if (headWidth + 2 + saidWidth < width) return `${row}  ${saidText}`
  return `${row}\n${' '.repeat(lead.length + 1 + gap.length + 2)}${saidText}`
}

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
    if (quoted !== undefined) out.push(`     ${c.muted}${quoted}${c.reset}`)
    quoted = undefined
  }
  for (const line of message.split('\n')) {
    const galley = GALLEY_LINE.exec(line)
    if (galley) {
      quote()
      out.push(`  ${c.bold}${c.detail}${galley[2]}${c.reset}`, `     ${galley[3]} ${c.muted}(${galley[1]})${c.reset}`)
      file = undefined
      source = true
      continue
    }
    if (source && line.trim() !== '') {
      out.push(`  ${c.muted}${line}${c.reset}`)
      continue
    }
    source = false
    const named = FILE_LINE.exec(line)
    if (named) {
      if (named[1] !== file) {
        quote()
        out.push(`  ${c.bold}${c.detail}${named[1]}${c.reset}`)
        quoted = sourceLine(siteDir, named[1]!)
      }
      file = named[1]
      out.push(`     ${named[2]}`)
      continue
    }
    quote()
    file = undefined
    if (/^\S.*:$/.test(line)) out.push(`  ${c.bold}${c.error}${line.slice(0, -1)}${c.reset}`, '')
    else out.push(`  ${line}`)
  }
  quote()
  if (isVerbose && error instanceof Error && error.stack) out.push('', c.muted + error.stack + c.reset)
  return out.join('\n') + '\n'
}

export const logger = {
  header(mode: 'dev' | 'publish') {
    buildStart = performance.now()
    const title = `  ${c.bold}hadley${c.reset} ${c.muted}—${c.reset} ${c.bold}${mode}${c.reset}`
    process.stdout.write(`\n${sep()}\n${title}\n${sep()}\n`)
  },

  /**
   * Call at step start, with the name and the short name for a narrow terminal — returns a done() function to call on
   * completion.
   *
   * const done = logger.step('generate cover images', 'covers')
   * // ... work ...
   * done('0 new · 2 cached')
   */
  step(label: string, short?: string) {
    const t0 = performance.now()
    running = { label, short, t0 }
    if (isTTY) {
      // an empty ring while the step is running, which its row overwrites with a full one
      const narrow = columns() < NARROW
      process.stdout.write(
        `${narrow ? ' ' : '  '}${c.muted}○${narrow ? ' ' : '  '}${narrow ? (short ?? label) : label}${c.reset}`,
      )
    }
    return (detail?: string, warns?: string[]) => {
      running = undefined
      const row = stepRow(
        { mark: '◉', label, short, ms: performance.now() - t0, detail, warns: warns?.length },
        columns(),
      )
      process.stdout.write(`${isTTY ? '\r' : ''}${row}\n`)
      if (warns?.length && isVerbose) {
        for (const w of warns) {
          process.stdout.write(`       ${c.warn}!  ${w}${c.reset}\n`)
        }
      }
    }
  },

  /** Per-item detail lines shown only when --verbose / -v / DEBUG=1 */
  verbose(items: string[]) {
    if (!isVerbose) return
    for (const item of items) {
      process.stdout.write(`       ${c.muted}${item}${c.reset}\n`)
    }
  },

  footer() {
    const total = performance.now() - buildStart
    const now = new Date()
    const ts = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    process.stdout.write(
      `${sep()}\n  ${c.bold}done${c.reset} in ${c.bold}${formatMs(total)}${c.reset}${c.muted} · ${ts}${c.reset}\n\n`,
    )
  },

  /** A command that did what it was asked, in a line of its own, with the path it wrote. */
  success(msg: string, path?: string) {
    process.stdout.write(`${c.check}✓${c.reset} ${msg}${path === undefined ? '' : ` ${c.detail}${path}${c.reset}`}\n`)
  },

  warn(msg: string) {
    process.stderr.write(`  ${c.bold}${c.warn}!${c.reset}  ${c.warn}${msg}${c.reset}\n`)
  },

  error(msg: string) {
    process.stderr.write(`  ${c.bold}${c.error}✕${c.reset}  ${msg}\n`)
  },

  /** A build that stopped: the step under way marked, then the failure (failureText). */
  failed(error: unknown, siteDir?: string) {
    if (running) {
      const { label, short, t0 } = running
      process.stdout.write(
        `${isTTY ? '\r' : ''}${stepRow({ mark: '✕', label, short, ms: performance.now() - t0 }, columns())}\n`,
      )
      running = undefined
    }
    process.stderr.write(failureText(error, siteDir))
  },
}
