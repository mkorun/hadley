/**
 * The site a command works on (README, "Dev-Server starten"): the directory `--root <dir>` names, else the one
 * HADLEY_ROOT names, else the nearest directory, from the current one upwards, that holds a config.lima. A directory
 * named that holds none, or none found, stops with where hadley looked.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse as limaparse } from '@limaformat/lima'
import { existsExactly } from './platform.ts'

/** The directory `--root <dir>` names, if it is given, and the arguments without it. */
export function rootOption(args: readonly string[]): { dir?: string; rest: string[] } {
  const rest = [...args]
  const at = rest.indexOf('--root')
  if (at === -1) return { rest }
  const dir = rest[at + 1]
  if (!dir || dir.startsWith('--')) throw new Error('--root needs the directory of a site')
  rest.splice(at, 2)
  return { dir, rest }
}

/** The site's directory, absolute: `dir` (from --root), else HADLEY_ROOT, else the nearest one with a config.lima. */
export function siteRoot(
  dir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const named =
    dir !== undefined
      ? { dir, by: '--root' }
      : env.HADLEY_ROOT
        ? { dir: env.HADLEY_ROOT, by: 'HADLEY_ROOT' }
        : undefined
  if (named) {
    const root = resolve(cwd, named.dir)
    if (!existsExactly(root, 'config.lima'))
      throw new Error(`${named.by} ${named.dir}: ${root} is no site, it holds no config.lima`)
    return root
  }
  for (let at = resolve(cwd); ; at = dirname(at)) {
    if (existsExactly(at, 'config.lima')) return at
    if (dirname(at) === at) break
  }
  throw new Error(
    `no site here: no config.lima in ${resolve(cwd)} or above it. Run hadley in a site's directory, or pass --root <dir>`,
  )
}

/** The site in messages: the host of the origin its config.lima gives, and its directory (or the directory alone). */
export function siteLabel(root: string, config: { site?: { origin?: unknown } } | null): string {
  const host = originHost(config)
  return host ? `${host} (${root})` : root
}

// the host of a site's origin, such as `mko.run`; none where config.lima names no origin
const originHost = (config: { site?: { origin?: unknown } } | null): string | undefined => {
  const origin = config?.site?.origin
  return typeof origin === 'string' && URL.canParse(origin) ? new URL(origin).host : undefined
}

/** The host of the site's origin, for the header of a build; none where config.lima has none or does not read. */
export async function siteHost(root: string): Promise<string | undefined> {
  try {
    return originHost(limaparse(await readFile(join(root, 'config.lima'), 'utf-8')) as { site?: { origin?: unknown } })
  } catch {
    // a config.lima that does not read stops the build a step later, with its message
    return undefined
  }
}
