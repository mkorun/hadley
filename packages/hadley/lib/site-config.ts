/**
 * What a site says of itself before any page is read: its meta files (content/meta, which config.lima and front
 * matter reference as %persons/…), config.lima, the fields it declares for its theme, a language's values, and the
 * theme's texts. A file LIMA rejects stops the build, with its path.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { isSystemFile, slashed } from './platform.ts'
import { parse as limaparse } from '@limaformat/lima'
import galley from '@mkorun/galley'
import type { Themes } from '../case/index.ts'
import { rawProblems } from './compile-templates.ts'
import { isHadleyField, RESERVED_FIELDS } from './front-matter.ts'
import type { Config, Language, Locale } from './site.ts'

// strict (Lima Core §10): an unterminated quote, a reference to no meta file or an inconsistent indent stops the
// build where it is, instead of reading as a text or nothing
const limaFile = async (path: string, partials?: Record<string, unknown>): Promise<unknown> => {
  const text = await readFile(path, 'utf-8')
  try {
    return limaparse(text, { strict: true, ...(partials ? { partials } : {}) })
  } catch (error) {
    const line = (error as { line?: unknown }).line
    const message = error instanceof Error ? error.message : String(error)
    // the line goes with the path, as a failure names a place (lib/logger.ts)
    if (typeof line !== 'number' || line < 1) throw new Error(`${path}: ${message}`, { cause: error })
    throw new Error(`${path}:${line}: ${message.replace(/ at line \d+/, '')}`, { cause: error })
  }
}

/**
 * The meta files of content/meta by their path without `.lima` (`persons/mko`), read in the order of their paths; a
 * site without them has none.
 */
export async function readMetaFiles(siteDir: string): Promise<Record<string, unknown>> {
  const metaDir = joinPath(siteDir, 'content', 'meta')
  const partials: Record<string, unknown> = {}
  let files: string[]
  try {
    files = (await readdir(metaDir, { recursive: true }))
      .map((file) => slashed(String(file)))
      .filter((file) => !file.split('/').some(isSystemFile))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return partials
    throw error
  }
  for (const rel of files) {
    if (!rel.endsWith('.lima')) continue
    const parsed = await limaFile(joinPath(metaDir, rel))
    const key = rel.slice(0, -'.lima'.length)
    partials[key] = parsed
    // a top-level _name.lima registers as name too, as it always did
    if (!key.includes('/') && key.startsWith('_')) partials[key.slice(1)] = parsed
  }
  return partials
}

/** The features config.lima turns on with `enabled: true` (docs/config.md). */
const SWITCHES = ['comments', 'maintenance', 'markdown', 'og', 'rss', 'search', 'typography'] as const

/**
 * config.lima, its references to meta files resolved. A switch is `enabled: true` or `false`: any other value would
 * leave its feature off without a word, so it stops.
 */
export async function readConfig(siteDir: string, partials: Record<string, unknown>): Promise<Config> {
  const config = (await limaFile(joinPath(siteDir, 'config.lima'), partials)) as Config
  for (const name of SWITCHES) switchOf(config, name)
  return config
}

function switchOf(config: Config, name: (typeof SWITCHES)[number]): void {
  const block: unknown = config[name]
  if (block === undefined) return
  if (block === null || typeof block !== 'object' || Array.isArray(block))
    throw new Error(`config.lima: ${name} is a block with enabled: true or false`)
  const enabled = (block as { enabled?: unknown }).enabled
  if (enabled !== undefined && typeof enabled !== 'boolean')
    throw new Error(`config.lima: ${name}.enabled is true or false, not ${String(enabled)}`)
}

/** Whether config.lima puts the site under maintenance: a publish build makes only its 503 page (config.md). */
export const underMaintenance = (config: Config): boolean => config.maintenance?.enabled === true

/** The language of the site's pages, config.lima `site.default.language`; a config.lima without one stops here. */
export function defaultLanguageOf(config: { site?: { default?: { language?: unknown } } }): string {
  const language = config.site?.default?.language
  if (typeof language !== 'string' || !language)
    throw new Error('config.lima: site.default.language is missing (the language of the pages, for example en)')
  return language
}

/** config.lima `highlighting`: `theme`, one Shiki theme, or `light` and `dark`; a site without highlights no code. */
export function highlightingThemes(config: Config): Themes | undefined {
  const highlighting = config.highlighting
  if (highlighting === undefined) return undefined
  const keys = highlighting && typeof highlighting === 'object' ? Object.keys(highlighting).sort().join(' ') : ''
  if (keys === 'theme') return highlighting.theme
  if (keys === 'dark light') return { light: highlighting.light, dark: highlighting.dark }
  throw new Error('config.lima: highlighting has theme, or light and dark (Shiki themes, https://shiki.style/themes)')
}

type FieldTemplate = Awaited<ReturnType<typeof galley>>

/** What config.lima says of the fields of a page (metadata: in config.lima). */
export interface FieldSchema {
  declared: ReadonlySet<string> // the fields a page may have beyond hadley's, for its theme
  aliases: Record<string, string> // another name of a field → the field
  defaults: Record<string, unknown>
  required: string[]
  allowed: Record<string, unknown[]> // the values a field may have
  templates: Record<string, FieldTemplate> // a field's HTML, from its value (html.fields)
  publishOnly: ReadonlySet<string> // shown as text in a dev build, as HTML when publishing
}

/**
 * The fields config.lima declares. A field's template is a galley template like the theme's: it escapes the values it
 * is given, and the build refuses any {@raw} in it.
 */
export async function fieldSchema(config: Config): Promise<FieldSchema> {
  // names count in Unicode's composed form (NFC), as the front matter's keys do (case/prepare-document.ts)
  const fields: Record<string, any> = Object.create(null)
  for (const [key, field] of Object.entries(config.metadata ?? {})) {
    const composed = key.normalize('NFC')
    if (Object.hasOwn(fields, composed)) throw new Error(`config.lima: metadata.${composed} is declared twice`)
    fields[composed] = field
  }
  const schema: FieldSchema = {
    declared: new Set(Object.keys(fields)),
    aliases: {},
    defaults: {},
    required: [],
    allowed: {},
    templates: {},
    publishOnly: new Set(Object.keys(fields).filter((key) => fields[key]?.publishOnly)),
  }
  for (const [key, field = {}] of Object.entries(fields)) {
    if (RESERVED_FIELDS.has(key)) throw new Error(`config.lima: metadata.${key} is a field hadley sets itself`)
    const cfg = field ?? {}
    if (cfg.required == true) schema.required.push(key)
    if (cfg.defaultValue) schema.defaults[key] = cfg.defaultValue
    const aliases: unknown = cfg.aliases ?? []
    if (!Array.isArray(aliases)) throw new Error(`config.lima: metadata.${key}.aliases is a list of names`)
    for (const spelled of aliases) {
      if (typeof spelled !== 'string' || spelled === '')
        throw new Error(`config.lima: metadata.${key}.aliases holds names, not ${String(spelled)}`)
      const alias = spelled.normalize('NFC')
      if (Object.hasOwn(schema.aliases, alias))
        throw new Error(`config.lima: ${alias} is another name of both ${schema.aliases[alias]} and ${key}`)
      if (Object.hasOwn(fields, alias) || isHadleyField(alias))
        throw new Error(`config.lima: ${alias}, another name of ${key}, is the name of a field itself`)
      schema.aliases[alias] = key
    }
    if (Array.isArray(cfg.allowed)) schema.allowed[key] = cfg.allowed
    if (cfg.template === undefined) continue
    if (typeof cfg.template !== 'string') throw new Error(`config.lima: the template of the field ${key} is not a text`)
    const problems = rawProblems(cfg.template, `config.lima: metadata.${key}.template`, 'field')
    if (problems.length > 0) throw new Error(`config.lima: the template of the field ${key}: ${problems.join('; ')}`)
    schema.templates[key] = await galley(cfg.template, {
      includes: {
        import: () => Promise.reject(new Error(`config.lima: the template of ${key} cannot include partials`)),
      },
    })
  }
  return schema
}

/**
 * The values of `language` from config.lima (site.<language>, else site.default), with no pages yet. A build for
 * the local server (`localServer`: a dev build, the preview of `hadley deploy`) sends comments to the page's own
 * origin, which passes them to the comments service (lib/dev-server.ts).
 */
export function languageRecord(
  config: Config,
  language: string,
  localServer: boolean,
  theme?: Record<string, unknown>,
): Language {
  const options = config.site
  const own = options[language]
  const defaults = options.default
  const record: Language = {
    origin: own?.origin ?? options.origin ?? '',
    title: own?.title ?? defaults?.title,
    claim: own?.claim ?? defaults?.claim,
    tagline: own?.tagline ?? defaults?.tagline,
    description: own?.description ?? defaults?.description,
    locale: own?.locale ?? defaults?.locale,
    since: options.since ? Number(options.since) : undefined,
    navigations: {},
    packages: config.packages ?? [],
    editors: config.editors ?? [],
    data: {},
    collections: {},
    taxonomy: { categories: {}, tags: {} },
    pages: {},
    listed: {},
  }
  if (config.comments?.enabled === true) {
    if (Object.hasOwn(config.comments, 'devUrl'))
      throw new Error('config.lima: comments.devUrl is gone; a local build sends comments to the local server')
    record.comments = { ...config.comments, ...(localServer ? { url: '' } : {}) }
  }
  if (config.search?.enabled === true) record.search = true
  if (config.rss?.enabled === true) record.rss = true
  if (theme) record.theme = theme
  if (options.issn) record.issn = String(options.issn)
  if (options.email) {
    record.email = String(options.email)
    record.emailMailto = `mailto:${options.email}`
  }
  return record
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The settings of the theme as config.lima sets them (`theme`), checked against those the theme has
 * (theme/theme.lima, `settings`): every setting the theme has, with its defaultValue where config.lima sets none. A
 * theme without theme.lima has none, and then config.lima sets none. A setting the theme does not have, or a value it
 * does not allow, stops here.
 */
export async function readThemeSettings(siteDir: string, config: Config): Promise<Record<string, unknown> | undefined> {
  const path = joinPath(siteDir, 'theme', 'theme.lima')
  const file = await limaFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  const set = config.theme
  if (set !== undefined && !isRecord(set))
    throw new Error('config.lima: theme holds the settings of the theme, each a key under it')
  if (file === undefined) {
    if (set !== undefined) throw new Error(`config.lima: theme has settings, and the theme has none (${path})`)
    return undefined
  }
  const settings = isRecord(file) ? file.settings : undefined
  if (!isRecord(settings)) throw new Error(`${path}: settings is missing (the theme's settings, each a key under it)`)
  const result: Record<string, unknown> = {}
  for (const [name, setting] of Object.entries(settings)) {
    if (!isRecord(setting) || !Object.hasOwn(setting, 'defaultValue'))
      throw new Error(`${path}: settings.${name} has no defaultValue`)
    const allowed = setting.allowed
    if (allowed !== undefined && !Array.isArray(allowed))
      throw new Error(`${path}: settings.${name}.allowed is no list`)
    if (allowed && !allowed.includes(setting.defaultValue))
      throw new Error(`${path}: settings.${name}.defaultValue ${setting.defaultValue} is not one of its allowed values`)
    const value = set && Object.hasOwn(set, name) ? set[name] : setting.defaultValue
    if (allowed && !allowed.includes(value))
      throw new Error(`config.lima: theme.${name} is ${value}, and the theme allows ${allowed.join(', ')}`)
    result[name] = value
  }
  for (const name of Object.keys(set ?? {})) {
    if (!Object.hasOwn(settings, name))
      throw new Error(
        `config.lima: theme.${name} is not a setting of the theme (${path}: ${Object.keys(settings).join(', ')})`,
      )
  }
  return result
}

/**
 * The theme's texts (theme/i18n/<lang>.lima) by language: a theme without texts has no i18n directory; one with
 * texts has them for every language of the site. Another language takes what its file leaves out from the default
 * language's.
 */
export async function readLocales(
  siteDir: string,
  languages: readonly string[],
  defaultLanguage: string,
): Promise<Record<string, Locale>> {
  const localeDir = joinPath(siteDir, 'theme', 'i18n')
  const files = await readdir(localeDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!files) return {}
  for (const lang of languages) {
    if (!files.includes(`${lang}.lima`))
      throw new Error(`${localeDir}/${lang}.lima is missing: the theme has texts, and the site has pages in ${lang}`)
  }
  const base = (await limaFile(`${localeDir}/${defaultLanguage}.lima`)) as Locale
  const locales: Record<string, Locale> = { [defaultLanguage]: base }
  for (const lang of languages) {
    if (lang !== defaultLanguage)
      locales[lang] = mergeLocale(base, (await limaFile(`${localeDir}/${lang}.lima`)) as Locale)
  }
  return locales
}

function mergeLocale(base: Locale, over: Locale): Locale {
  const result = { ...base }
  for (const [k, v] of Object.entries(over)) {
    result[k] =
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? { ...((base[k] as object) ?? {}), ...(v as object) }
        : v
  }
  return result
}
