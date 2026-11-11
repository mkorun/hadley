/**
 * hadley init (docs/init.md): a new site from a starter and a theme hadley brings, in the languages it names. A
 * starter is a site in English with every other language in the bundles' language folders and in blocks or keys named
 * after it in its Lima files; init keeps the languages named and makes the first the default.
 */
import { spawnSync } from 'node:child_process'
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSystemFile, lf, pathsBelow } from './platform.ts'
import { fileURLToPath } from 'node:url'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
export const STARTERS = join(PACKAGE, 'starters')
export const THEMES = join(PACKAGE, 'themes')

// the language a starter's bundles are written in, which its config.lima makes the default
const STARTER_DEFAULT = 'en'

/** The languages `starter` is written in: the blocks of `site:` in its config.lima, in their order, English first. */
export async function starterLanguages(starter: string): Promise<string[]> {
  const lines = lf(await readFile(join(STARTERS, starter, 'config.lima'), 'utf-8')).split('\n')
  const languages: string[] = []
  for (const line of lines.slice(lines.indexOf('site:') + 1)) {
    if (line.trim() !== '' && !line.startsWith(' ')) break
    const key = /^ {2}([a-z]{2}):\s*$/.exec(line)?.[1]
    if (key !== undefined) languages.push(key)
  }
  if (languages[0] !== STARTER_DEFAULT)
    throw new Error(`the starter ${starter}: the first language block of its config.lima is not ${STARTER_DEFAULT}`)
  return languages
}

/** The languages `--language` names (`de,en`, `all`) of those the starter is `written` in, the default first. */
export function parseLanguages(text: string | undefined, written: readonly string[]): string[] {
  if (text === undefined) return [STARTER_DEFAULT]
  if (text === 'all') return [...written]
  const languages = text.split(',').map((language) => language.trim())
  for (const [i, language] of languages.entries()) {
    if (!written.includes(language))
      throw new Error(`--language ${text}: the starter is written in ${written.join(', ')}, not "${language}"`)
    if (languages.indexOf(language) !== i) throw new Error(`--language ${text}: ${language} is named twice`)
  }
  return languages
}

/**
 * `text` (Lima) without the blocks and keys named after a language in `dropped`, each with the lines indented under
 * it; the blank lines after such a block stay where the text goes on.
 */
export function withoutLanguages(text: string, dropped: readonly string[]): string {
  const kept: string[] = []
  let blockIndent = -1 // the indent of the block left out, while its lines are
  let blanks: string[] = []
  for (const line of text.split('\n')) {
    const indent = line.length - line.trimStart().length
    if (blockIndent >= 0) {
      if (line.trim() === '') {
        blanks.push(line)
        continue
      }
      if (indent > blockIndent) {
        blanks = []
        continue
      }
      blockIndent = -1
      kept.push(...blanks)
      blanks = []
    }
    const key = /^\s*([a-z]{2}):(?:\s|$)/.exec(line)?.[1]
    if (key !== undefined && dropped.includes(key)) blockIndent = indent
    else kept.push(line)
  }
  return [...kept, ...blanks].join('\n')
}

/** The blocks of `starter:` in a theme's `theme.lima`, as top-level Lima; nothing without it. */
export function starterBlocks(themeLima: string): string {
  const lines = themeLima.split('\n')
  const start = lines.findIndex((line) => /^starter:\s*(?:#.*)?$/.test(line))
  if (start === -1) return ''
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break
    block.push(line)
  }
  const indent = Math.min(...block.filter((line) => line.trim() !== '').map((line) => line.search(/\S/)))
  return block
    .map((line) => line.slice(indent))
    .join('\n')
    .trim()
}

/**
 * A starter's `config.lima` for `languages` of those it is `written` in, the first the default, with the blocks of the
 * theme's `starter:` and `year` as the site's `since`.
 */
export function configFor(
  config: string,
  languages: readonly string[],
  written: readonly string[],
  themeLima: string,
  year: number,
): string {
  const text = withoutLanguages(
    config,
    written.filter((language) => !languages.includes(language)),
  )
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.trim() === `language: ${STARTER_DEFAULT}` && /^\s/.test(line))
  if (at === -1) throw new Error(`the starter's config.lima names no default language ${STARTER_DEFAULT}`)
  lines[at] = lines[at]!.replace(STARTER_DEFAULT, () => languages[0]!)
  const owner = lines.findIndex((line) => /^  owner:/.test(line))
  if (owner === -1) throw new Error("the starter's config.lima names no site owner")
  lines.splice(owner + 1, 0, `  since: ${year}  # the first year of the copyright line`)
  const own = lines.join('\n').trimEnd()
  const blocks = starterBlocks(themeLima)
  return blocks
    ? `${own}\n\n# What the theme starts a site with (theme/theme.lima, starter:).\n${blocks}\n`
    : `${own}\n`
}

/**
 * A page of the starter in `language` as the site has it whose default is `defaultLanguage`: a `urlPath` loses the
 * prefix of the language that becomes the default and gains `/en/` where English no longer is.
 */
export function pageFor(text: string, language: string, defaultLanguage: string): string {
  return text.replace(/^(urlPath:\s*)(\S+)/m, (_, key: string, path: string) => {
    if (language === defaultLanguage && path.startsWith(`/${language}/`)) return key + path.slice(language.length + 1)
    if (language === STARTER_DEFAULT && language !== defaultLanguage) return `${key}/${language}${path}`
    return key + path
  })
}

const exists = async (path: string) => (await stat(path).catch(() => undefined)) !== undefined

/** The starters or (`THEMES`) the themes hadley brings, by name. */
export async function namesOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** The starter without sample content, which goes with every theme; any other is its theme's own, named after it. */
export const BLANK = 'blank'

/** The notes for a coding agent every new site gets as its AGENTS.md (docs/init.md), the same for every starter. */
export const AGENTS = join(STARTERS, 'site-agents.md')

/** The `.gitignore` and `.gitattributes` every new site gets (docs/init.md). */
export const GITIGNORE = join(STARTERS, 'site-gitignore')
export const GITATTRIBUTES = join(STARTERS, 'site-gitattributes')

/** What `--git` made (docs/init.md): a repository with the site as its first commit, one without, or none. */
export type GitOutcome =
  | { made: 'commit' }
  | { made: 'repository'; git: string } // what git said of the commit that failed
  | { made: 'nothing'; inside: string } // the repository the site is inside already

const GIT_TIMEOUT_MS = 60_000

function git(dir: string, args: string[]) {
  const run = spawnSync('git', ['-C', dir, ...args], { timeout: GIT_TIMEOUT_MS, encoding: 'utf-8' })
  return { ok: run.status === 0, out: run.stdout?.trim() ?? '', said: run.error?.message ?? run.stderr?.trim() ?? '' }
}

/** Makes `dir` a git repository with all in it as its first commit, unless it is inside one already. */
function gitRepository(dir: string): GitOutcome {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (top.ok) return { made: 'nothing', inside: top.out }
  for (const args of [
    ['init', '--quiet'],
    ['add', '--all'],
  ]) {
    const run = git(dir, args)
    if (!run.ok) throw new Error(`--git: git ${args[0]}: ${run.said}`)
  }
  const commit = git(dir, ['commit', '--quiet', '--message', 'hadley init'])
  return commit.ok ? { made: 'commit' } : { made: 'repository', git: commit.said }
}

/** The starter of `theme`: its own, or with `blank` the blank one (docs/init.md). */
export async function starterOf(theme: string, blank: boolean): Promise<string> {
  const themes = await namesOf(THEMES)
  if (!themes.includes(theme)) throw new Error(`--theme ${theme}: hadley brings ${themes.join(', ')}`)
  if (blank) return BLANK
  if (!(await namesOf(STARTERS)).includes(theme)) throw new Error(`the theme ${theme} brings no starter (starters/)`)
  return theme
}

/**
 * Makes the site in `dir` from `theme` and its `starter` (starterOf), in `languages`, and with `git` a git repository
 * of it (docs/init.md).
 */
export async function init(
  dir: string,
  languages: readonly string[],
  theme: string,
  starter: string,
  { git: withGit = false } = {},
): Promise<GitOutcome | undefined> {
  if (starter !== (await starterOf(theme, starter === BLANK)))
    throw new Error(`the starter ${starter} is not the theme ${theme}'s: a theme comes with its own or the blank one`)
  if (withGit) {
    const version = git('.', ['--version'])
    if (!version.ok) throw new Error(`--git: there is no git on this machine (${version.said})`)
  }
  const written = await starterLanguages(starter)
  const starterDir = join(STARTERS, starter)
  if ((await exists(dir)) && (await readdir(dir)).length > 0)
    throw new Error(`${dir} is not empty: hadley init makes a site in an empty or new directory`)
  const [defaultLanguage] = languages as [string]
  const themeDir = join(THEMES, theme)

  await mkdir(dir, { recursive: true })
  await cp(themeDir, join(dir, 'theme'), { recursive: true })
  const themeLima = lf(await readFile(join(themeDir, 'theme.lima'), 'utf-8').catch(() => ''))
  const config = lf(await readFile(join(starterDir, 'config.lima'), 'utf-8'))
  await writeFile(join(dir, 'config.lima'), configFor(config, languages, written, themeLima, new Date().getFullYear()))
  // the site's own from now on, as its theme is: init writes them once, and nothing of hadley again
  await copyFile(AGENTS, join(dir, 'AGENTS.md'))
  await writeFile(join(dir, 'CLAUDE.md'), '@AGENTS.md\n')
  await copyFile(GITIGNORE, join(dir, '.gitignore'))
  await copyFile(GITATTRIBUTES, join(dir, '.gitattributes'))

  const dropped = written.filter((language) => !languages.includes(language))
  const content = join(starterDir, 'content')
  for (const path of (await pathsBelow(content)).sort()) {
    if (path.split('/').some(isSystemFile) || !(await stat(join(content, path))).isFile()) continue
    const target = targetOf(path.split('/'), languages, defaultLanguage)
    if (target === null) continue
    const to = join(dir, 'content', ...target.segments)
    await mkdir(dirname(to), { recursive: true })
    if (target.page !== undefined) {
      await writeFile(to, pageFor(lf(await readFile(join(content, path), 'utf-8')), target.page, defaultLanguage))
    } else if (path.endsWith('.lima')) {
      await writeFile(to, withoutLanguages(lf(await readFile(join(content, path), 'utf-8')), dropped))
    } else await copyFile(join(content, path), to)
  }
  return withGit ? gitRepository(dir) : undefined
}

/**
 * Where a file of the starter's content goes, by its path's segments: a file of a language not named nowhere (null),
 * the default language's into the bundle, English ones into `en/` when English is not the default. A file in a bundle
 * that is no page (an image) belongs to every language and stays where it is. A page carries its language.
 */
export function targetOf(
  segments: string[],
  languages: readonly string[],
  defaultLanguage: string,
): { segments: string[]; page?: string } | null {
  const bundle = segments.findLastIndex((segment, i) => i < segments.length - 1 && /^\[.+\]$/.test(segment))
  const inBundle = bundle === -1 ? [] : segments.slice(bundle + 1)
  const name = segments.at(-1)!
  const isPage = name.endsWith('.md')
  if (inBundle.length > 2) throw new Error(`the starter's ${segments.join('/')} is deeper than a language folder`)
  if (inBundle.length === 0 || (inBundle.length === 1 && !isPage)) return { segments }
  const language = inBundle.length === 1 ? STARTER_DEFAULT : inBundle[0]!
  if (!languages.includes(language)) return null
  const place = language === defaultLanguage ? [] : [language]
  const to = [...segments.slice(0, bundle + 1), ...place, name]
  return isPage ? { segments: to, page: language } : { segments: to }
}
