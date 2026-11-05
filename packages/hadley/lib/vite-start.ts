/**
 * Starts the Vite server of `hadley dev`. Vite starts in well under a second, but its listen() has hung in the CI,
 * rarely and never twice in a row, with no cause found. So a start that has not answered after `stallMs` asks whether
 * the port answers: a server that bound it is up, and hadley goes on; one that did not is closed and made anew, once.
 * A second start that hangs as well stops hadley dev (docs/dev-server.md).
 */

export interface Listening {
  listen(): Promise<unknown>
  close(): Promise<void>
}

export interface StartOptions {
  port: number
  stallMs: number
  // whether something answers on the port (portInUse in lib/dev-options.ts)
  bound: (port: number) => Promise<boolean>
  warn: (message: string) => void
}

// true once `promise` is fulfilled, false when `ms` passed first; a rejection passes on
const within = (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), ms)
  })
  return Promise.race([promise.then(() => true as const), late]).finally(() => clearTimeout(timer))
}

export async function startVite<S extends Listening>(make: () => Promise<S>, options: StartOptions): Promise<S> {
  const { port, stallMs, bound, warn } = options
  const seconds = stallMs / 1000
  let server = await make()
  for (let attempt = 1; ; attempt++) {
    if (await within(server.listen(), stallMs)) return server
    if (await bound(port)) {
      warn(`Vite has not said it started after ${seconds} s, but port ${port} answers: going on`)
      return server
    }
    if (attempt === 2)
      throw new Error(`Vite has not started twice, ${seconds} s each, and port ${port} is free: start hadley dev again`)
    warn(`Vite has not started after ${seconds} s, and port ${port} is free: starting it again`)
    // a server that hangs may not close either
    await within(server.close(), 2_000)
    server = await make()
  }
}
