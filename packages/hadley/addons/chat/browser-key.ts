/**
 * The browser's key to the chat (docs/dev-server.md, "Chat"). The chat's routes answer a browser that holds it, and
 * nothing else on this machine: a page's Origin, which a browser cannot fake, a local program can. `hadley dev`
 * prints a link with the key; the panel keeps it in its origin's storage, which scheme, host and port bound (a cookie
 * would go to every port of localhost), and sends it with each request. The key is the site's, kept in the private
 * runtime directory beside the channel's rendezvous, so that a browser keeps it across restarts of the dev server.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY = /^[0-9a-f]{64}$/

export interface BrowserKey {
  key: string
  file: string
}

/**
 * The site's key, read from the private directory, or made and kept there (mode 0600). Only a plain file that only its
 * owner can read counts: a link, or a file others may read, is replaced (review 2026-11-05).
 */
export function browserKey(dir: string, root: string): BrowserKey {
  const site = createHash('sha256').update(root).digest('hex').slice(0, 16)
  const file = join(dir, `key-${site}`)
  try {
    const stat = lstatSync(file)
    const own = process.getuid === undefined || stat.uid === process.getuid()
    if (stat.isFile() && own && (stat.mode & 0o077) === 0) {
      const key = readFileSync(file, 'utf8').trim()
      if (KEY.test(key)) return { key, file }
    }
    rmSync(file, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32).toString('hex')
  writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' })
  return { key, file }
}

/** Whether a value is the key, compared in constant time. */
export function isKey(value: string | undefined, key: string): boolean {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(key) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(key))
  )
}
