/**
 * The browser's key to the chat (docs/dev-server.md, "Chat"). The chat's routes answer a browser that holds it, and
 * nothing else on this machine: a page's Origin, which a browser cannot fake, a local program can. `hadley dev` prints a
 * link with the key; its first visit sets a cookie, HttpOnly and SameSite=Strict, which the routes then ask for. The key
 * is the site's, kept in the private runtime directory beside the channel's rendezvous, so that the cookie stays good
 * across restarts of the dev server.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY = /^[0-9a-f]{64}$/

export interface BrowserKey {
  key: string
  file: string
  // the cookie's name, the site's own: several dev servers on localhost share one cookie jar, whatever their ports
  cookie: string
}

/** The site's key, read from the private directory, or made and kept there (mode 0600) the first time. */
export function browserKey(dir: string, root: string): BrowserKey {
  const site = createHash('sha256').update(root).digest('hex').slice(0, 16)
  const file = join(dir, `key-${site}`)
  const cookie = `hadley-chat-${site}`
  try {
    const key = readFileSync(file, 'utf8').trim()
    if (KEY.test(key)) return { key, file, cookie }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32).toString('hex')
  writeFileSync(file, `${key}\n`, { mode: 0o600 })
  return { key, file, cookie }
}

/** Whether a value is the key, compared in constant time. */
export function isKey(value: string | undefined, key: string): boolean {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(key) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(key))
  )
}

/** A cookie's value from a Cookie header, or undefined. */
export function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  for (const part of String(header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}
