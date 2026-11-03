import { constants, openSync, closeSync, fchmodSync, fstatSync, appendFileSync } from 'node:fs'

/** Optional private traffic log. Headers and rendezvous files never enter this sink. */
export function trafficLog(file: string | undefined) {
  const tokens = new Set<string>()
  let fd: number | undefined
  if (file !== undefined) {
    if (!file) throw new Error('HADLEY_CHAT_LOG: expected a file path')
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600)
    try {
      if (!fstatSync(fd).isFile()) throw new Error('HADLEY_CHAT_LOG: expected a regular file')
      fchmodSync(fd, 0o600)
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }
  return {
    token(value: string): void {
      tokens.add(value)
    },
    write(direction: string, data: unknown, server?: string): void {
      if (fd === undefined) return
      let line = JSON.stringify({ timestamp: new Date().toISOString(), direction, server, data })
      for (const token of tokens) line = line.replaceAll(token, '[redacted]')
      appendFileSync(fd, line + '\n')
    },
    close(): void {
      if (fd !== undefined) closeSync(fd)
      fd = undefined
    },
  }
}
