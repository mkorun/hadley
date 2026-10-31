/**
 * What hadley knows of the machine it runs on, not of a site: `$XDG_CONFIG_HOME/hadley/config.lima`, else
 * `~/.config/hadley/config.lima` (docs/dev-server.md). Every key is optional and the file too; a key hadley does not
 * know, or a value of another kind, stops with the file named.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as limaparse } from '@limaformat/lima'

export interface UserConfig {
  dev: {
    hostname?: string // the name other devices reach this machine by (`hadley dev --host`)
    allowedHosts: string[] // other names the dev server answers to (a tunnel's)
    https?: { cert: string; key: string } // the certificate `hadley dev --https` serves with, relative to the file
    open?: string[] // the program and arguments that open a URL in the browser; the URL is added last
    forms?: string // the comments service hadley dev starts, instead of hadley-forms on the PATH; relative to the file
  }
}

/** The directory of the user configuration. */
export const userConfigDir = (env: NodeJS.ProcessEnv = process.env): string =>
  join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hadley')

/** The user configuration; `HADLEY_DEV_HOST` replaces `dev.hostname`. */
export async function readUserConfig(env: NodeJS.ProcessEnv = process.env): Promise<UserConfig> {
  const dir = userConfigDir(env)
  const path = join(dir, 'config.lima')
  const text = await readFile(path, 'utf-8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  const fail = (message: string): never => {
    throw new Error(`${path}: ${message}`)
  }
  let parsed: unknown = {}
  if (text !== undefined) {
    try {
      parsed = limaparse(text) ?? {}
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  const record = (value: unknown, name: string): Record<string, unknown> =>
    value === undefined || value === null
      ? {}
      : typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : fail(`${name} is not a group of keys`)
  const known = (value: Record<string, unknown>, name: string, keys: string[]) => {
    for (const key of Object.keys(value))
      if (!keys.includes(key)) fail(`${name ? `${name}.` : ''}${key} is no key hadley knows (${keys.join(', ')})`)
  }
  const textOf = (value: unknown, name: string): string | undefined =>
    value === undefined ? undefined : typeof value === 'string' && value !== '' ? value : fail(`${name} is not a text`)
  const textsOf = (value: unknown, name: string): string[] | undefined =>
    value === undefined
      ? undefined
      : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item !== '')
        ? value
        : fail(`${name} is not a list of texts`)

  const top = record(parsed, 'the file')
  known(top, '', ['dev'])
  const dev = record(top.dev, 'dev')
  known(dev, 'dev', ['hostname', 'allowedHosts', 'https', 'open', 'forms'])
  const hostname = env.HADLEY_DEV_HOST || textOf(dev.hostname, 'dev.hostname')
  const https = dev.https === undefined ? undefined : record(dev.https, 'dev.https')
  if (https) known(https, 'dev.https', ['cert', 'key'])
  const cert = https && textOf(https.cert, 'dev.https.cert')
  const key = https && textOf(https.key, 'dev.https.key')
  if (https && (!cert || !key)) fail('dev.https needs both cert and key')
  const open = textsOf(dev.open, 'dev.open')
  const forms = textOf(dev.forms, 'dev.forms')
  return {
    dev: {
      ...(hostname ? { hostname } : {}),
      allowedHosts: textsOf(dev.allowedHosts, 'dev.allowedHosts') ?? [],
      ...(cert && key ? { https: { cert: resolve(dir, cert), key: resolve(dir, key) } } : {}),
      ...(open ? { open } : {}),
      ...(forms ? { forms: resolve(dir, forms) } : {}),
    },
  }
}
