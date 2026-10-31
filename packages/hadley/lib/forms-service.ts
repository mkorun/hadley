/**
 * The comments service `hadley dev` starts (services/forms/CONTRACT.md C11): `dev.forms` of the user configuration,
 * else `hadley-forms` on the PATH. Its data and the secrets it makes lie in the site's `.hadley/forms/`.
 */
import { join, resolve } from 'node:path'
import { isProgram, onPath } from './platform.ts'

export const FORMS_PROGRAM = 'hadley-forms'

/** The site's data directory of the local service; its `dev-secrets.json` holds the admin token the CLI uses. */
/**
 * The environment of the service `hadley dev` starts, without what belongs to one in production: its secrets, which it
 * makes itself in its data directory, and the notifications of real comments.
 */
export const devServiceEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(([name]) => !/^(?:ADMIN_TOKEN|HMAC_SECRET|SITE_META|NTFY_.*)$/.test(name)),
  )

export const formsDataDir = (siteDir: string): string => join(siteDir, '.hadley', 'forms')

/**
 * The program to start, as an absolute path: `configured` (dev.forms), which must be an executable file, else the
 * first `hadley-forms` in an absolute directory of `path`; undefined when there is none. A relative directory of the
 * PATH is skipped: it would name another program in the site's directory, where the service is started.
 */
export function formsProgram(configured: string | undefined, path = process.env.PATH ?? ''): string | undefined {
  if (configured !== undefined) {
    const program = resolve(configured)
    if (!isProgram(program)) throw new Error(`dev.forms: ${configured} is no program that can be run`)
    return program
  }
  return onPath(FORMS_PROGRAM, path)
}
