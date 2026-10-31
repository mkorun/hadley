/**
 * Where other devices reach `hadley dev --host` (docs/dev-server.md): the name the user configuration gives this
 * machine (`dev.hostname`, or HADLEY_DEV_HOST), then every IPv4 address of a network interface that is not the
 * machine's own; the first one also as a QR code, when the optional package uqr is installed. Under WSL in NAT mode
 * no address of Linux is one another device reaches, so there are none (wslNetworking).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'

/** The URLs of the dev server on other devices, the configured name first. */
export function networkUrls(
  options: { port: number; https: boolean },
  hostname: string | undefined,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  const scheme = options.https ? 'https' : 'http'
  const addresses = Object.values(interfaces)
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address!.address)
  return [...(hostname ? [hostname] : []), ...new Set(addresses)].map((host) => `${scheme}://${host}:${options.port}`)
}

/** `url` as a QR code of block characters, or undefined without uqr (package.json, optionalDependencies). */
export async function qrCode(url: string): Promise<string | undefined> {
  // a specifier the type checker does not resolve: uqr may be missing
  const uqr = (await import('uqr' as string).catch(() => undefined)) as
    | { renderUnicodeCompact: (text: string) => string }
    | undefined
  return uqr?.renderUnicodeCompact(url)
}

/**
 * The networking mode of WSL (`nat`, `mirrored`, …) when hadley runs in WSL, as `wslinfo` tells it, `unknown` when
 * it cannot; undefined anywhere else.
 */
export function wslNetworking(
  osRelease = () => readFileSync('/proc/sys/kernel/osrelease', 'utf-8'),
  wslinfo = () => spawnSync('wslinfo', ['--networking-mode'], { encoding: 'utf-8', timeout: 5_000 }),
): string | undefined {
  let release = ''
  try {
    release = osRelease()
  } catch {
    return undefined
  }
  if (!/microsoft|wsl/i.test(release)) return undefined
  const told = wslinfo()
  const mode = told.status === 0 ? String(told.stdout).trim() : ''
  return mode || 'unknown'
}
