/**
 * How `hadley dev` and the local server of `hadley deploy` serve (docs/dev-server.md): on localhost over HTTP at the
 * site's port (`dev.port` in its config.lima, else 8000) unless `--port`, `--https` or `--host` (every network
 * interface, for other devices) say otherwise. The comments service listens on the next port.
 */
import { connect } from 'node:net'

export interface DevOptions {
  port: number
  https: boolean
  host: boolean
}

export const DEV_PORT = 8000

/** The port of the comments service a dev server on `port` starts and proxies to. */
export const commentsPort = (port: number): number => port + 1

const isPort = (port: unknown): port is number =>
  Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65534

/** The port of a site's config.lima (`dev.port`), else 8000; a value that is not a port stops. */
export function sitePort(config: { dev?: { port?: unknown } } | null): number {
  const port = config?.dev?.port
  if (port === undefined) return DEV_PORT
  if (!isPort(port)) throw new Error(`config.lima: dev.port needs a port from 1 to 65534, not ${port}`)
  return port
}

/**
 * Whether a site's config.lima turns the block editor on (`dev.editor: true`); off without it, and a value that is not
 * true or false stops.
 */
export function siteEditor(config: { dev?: { editor?: unknown } } | null): boolean {
  const editor = config?.dev?.editor
  if (editor === undefined) return false
  if (typeof editor !== 'boolean') throw new Error(`config.lima: dev.editor is true or false, not ${editor}`)
  return editor
}

/**
 * The options of `args`, with `port` (the site's) unless `--port` gives another, and the arguments that are none of
 * them; a `--port` that is not a port stops.
 */
export function devOptions(args: readonly string[], port = DEV_PORT): { options: DevOptions; rest: string[] } {
  const options: DevOptions = { port, https: false, host: false }
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--https') options.https = true
    else if (arg === '--host') options.host = true
    else if (arg === '--port') {
      const value = args[++i]
      const port = Number(value)
      if (!value || !isPort(port)) throw new Error(`--port needs a port from 1 to 65534, not ${value ?? 'nothing'}`)
      options.port = port
    } else rest.push(arg)
  }
  return { options, rest }
}

/** The origin a browser on this machine opens. */
export const localOrigin = (options: DevOptions): string =>
  `${options.https ? 'https' : 'http'}://localhost:${options.port}`

/** Whether something on this machine already answers on `port`, over IPv4 or IPv6 (another dev server, for one). */
export async function portInUse(port: number): Promise<boolean> {
  const answers = (host: string) =>
    new Promise<boolean>((done) => {
      const socket = connect({ host, port, timeout: 1_000 })
      socket.once('connect', () => {
        socket.destroy()
        done(true)
      })
      socket.once('error', () => done(false))
      socket.once('timeout', () => {
        socket.destroy()
        done(false)
      })
    })
  return (await Promise.all([answers('127.0.0.1'), answers('::1')])).some(Boolean)
}
