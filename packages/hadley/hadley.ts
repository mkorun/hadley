#!/usr/bin/env bun
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as limaparse } from '@limaformat/lima'
import { build } from './index.ts'
import { logger, withoutVerbose } from './lib/logger.ts'
import { commentsPort, devOptions, sitePort } from './lib/dev-options.ts'
import { rootOption, siteLabel, siteRoot } from './lib/site-root.ts'
import pkg from './package.json' with { type: 'json' }

// Vite, only when a server runs
const startDevServer = async (...args: Parameters<typeof import('./lib/dev-server.ts').startDevServer>) =>
  (await import('./lib/dev-server.ts')).startDevServer(...args)

// the site a command works on, once it is found, so that a failure names its files relative to it
let siteDir: string | undefined

function fail(problem: unknown): never {
  logger.failed(problem, siteDir)
  process.exit(1)
}

// the site, from --root, HADLEY_ROOT or the directory hadley runs in (lib/site-root.ts), found when a command needs it
const argv = withoutVerbose(process.argv.slice(2))
if (argv.includes('--site')) fail("--site is gone: run hadley in the site's directory, or pass --root <dir>")
let option: ReturnType<typeof rootOption>
try {
  option = rootOption(argv)
} catch (error) {
  fail(error)
}
const site = (): string => {
  try {
    return (siteDir = siteRoot(option.dir))
  } catch (error) {
    return fail(error)
  }
}

const [command, ...rest] = option.rest

// the site's config.lima as the dev server reads it, without its partials (lib/dev-server.ts)
const siteConfig = async (root: string) =>
  limaparse(await readFile(join(root, 'config.lima'), 'utf-8')) as Record<string, any> | null

// how a server of the site serves: on --port, else on dev.port of its config.lima, else on 8000
const serving = async (root: string) => {
  try {
    return devOptions(rest, sitePort(await siteConfig(root))).options
  } catch (error) {
    return fail(error)
  }
}

const hasBuildFlag = rest.includes('--build')
const hasHelpFlag = rest.includes('--help') || rest.includes('-h')

// --- Help ---

const HELP: Record<string, string> = {
  global: `
hadley v${pkg.version} — Static Site Generator

Usage:  hadley [--root <dir>] <command> [options]

The site is the directory --root names, else the one HADLEY_ROOT names, else the nearest one, from the current
directory upwards, that holds a config.lima.

Commands:
  init [dir]         A new site: a theme with its starter (--language, --theme, --blank)
  dev                Dev server + file watcher (http://localhost:8000, or dev.port of config.lima)
  dev comments       Comment moderation TUI against local dev service
  deploy             Publish build + local server
  clean              Clear all build directories of the site
  comments           Comment moderation TUI against production (docs/comments.md)
  version            Print version

Run "hadley <command> --help" for details.`.trim(),

  init: `
hadley init — A new site

  hadley init [dir]                  hems with its starter, Feather Cat, in dir (default: here), in English
  hadley init --theme punch          punch with its starter, Noa Varela's personal site
  hadley init --language de          In German
  hadley init --language de,en       In German and English, German the default (the first)
  hadley init --language all         In all the starter is written in (each: en, de, fr, es, it)
  hadley init --blank                Without sample content: home, imprint, feed and 404 only

  dir must be empty or not exist (docs/init.md).`.trim(),

  dev: `
hadley dev — Development server

  hadley dev                 Build + file watcher + Vite at http://localhost:8000 (or dev.port of config.lima)
  hadley dev --https         The same over HTTPS (certificate: docs/dev-server.md)
  hadley dev --port <n>      Another port (the comments service takes the next one)
  hadley dev --host          Also for other devices: every network interface, their addresses and a QR code
  hadley dev --build         Build only, no server, no file watcher
  hadley dev comments        Comment moderation TUI against the local comments service

  Output:  <site>/.hadley/dev/

  Starts hadley-forms (on the PATH, or dev.forms of the user configuration) if config.lima sets comments.enabled:
  true; the dev server passes /api/comment/ and /admin/ to it (docs/comments.md).
  Run "hadley clean" first if pages were deleted (stale output is not removed).`.trim(),

  deploy: `
hadley deploy — Publish build + local server

  hadley deploy             Publish build + static server (local preview; --https, --port, --host as for dev)
  hadley deploy --build     Publish build only (no server, for deployment)

  Output: <site>/.hadley/publish/

  One publish build: production URLs, no dev indicators, the theme's stylesheets and scripts minified under the
  hash of their bytes, and the Pagefind search index when config.lima sets search.enabled: true.

  --build is the deployment flag: no server, production URLs, writes meta.json.
  Without --build: comments go to the local server (local testing).`.trim(),

  clean: `
hadley clean — Clear build directories

  Clears and recreates for the site:
    .hadley/dev/   .hadley/publish/   .hadley/cache/

  Use after deleting content pages to remove stale build output.`.trim(),

  comments: `
hadley comments — Comment moderation TUI (production)

  Connects to comments.url of config.lima with the admin token from HADLEY_COMMENTS_TOKEN, else from
  ~/.config/hadley/comments/<host of site.origin>.token (mode 600); keeps its decisions in comments.archive.

  hadley dev comments   → the comments service of the dev server (its port + 1), with the token it made.

  Keys:  a approve   r reject   e edit   n note   c reply   m mail   q quit   (docs/comments.md)`.trim(),
}

if (command === '--help' || command === '-h' || command == null) {
  console.log(HELP.global)
  process.exit(0)
}
if (hasHelpFlag && HELP[command]) {
  console.log(HELP[command])
  process.exit(0)
}

// every failure as the logger sets it (lib/logger.ts, failureText); --verbose adds the stack
try {
  switch (command) {
    case 'init': {
      const { init, parseLanguages, starterLanguages, starterOf } = await import('./lib/init.ts')
      const value = (name: string): string | undefined => {
        const at = rest.indexOf(name)
        if (at === -1) return undefined
        const given = rest[at + 1]
        if (given === undefined || given.startsWith('--')) fail(`${name} needs a value`)
        return given
      }
      const named = new Set(['--language', '--theme'])
      const unknown = rest.find(
        (arg, i) => arg.startsWith('--') && arg !== '--blank' && !named.has(arg) && !named.has(rest[i - 1] ?? ''),
      )
      if (unknown) fail(`hadley init has no option ${unknown} (hadley init --help)`)
      const positional = rest.filter((arg, i) => !arg.startsWith('--') && !named.has(rest[i - 1] ?? ''))
      if (positional.length > 1) fail(`hadley init takes one directory, not ${positional.join(' ')}`)
      const dir = resolve(positional[0] ?? '.')
      try {
        const theme = value('--theme') ?? 'hems'
        const starter = await starterOf(theme, rest.includes('--blank'))
        const languages = parseLanguages(value('--language'), await starterLanguages(starter))
        await init(dir, languages, theme, starter)
        console.log(`✅ A new site in ${dir}: ${theme} with the starter ${starter}, in ${languages.join(', ')}`)
        console.log(`   Next: ${positional[0] ? `cd ${positional[0]} && ` : ''}hadley dev`)
      } catch (error) {
        fail(error)
      }
      break
    }

    case 'dev': {
      const root = site()
      const serve = await serving(root)
      if (rest[0] === 'comments') {
        const { runCommentsCli } = await import('./addons/forms/index.ts')
        // the comments service of a dev server on the same port, directly
        await runCommentsCli(root, { dev: true, devServiceUrl: `http://127.0.0.1:${commentsPort(serve.port)}` })
      } else if (hasBuildFlag) {
        await build(root, 'dev')
      } else {
        await startDevServer({ siteDir: root, outputMode: 'dev', serve })
      }
      break
    }

    case 'deploy': {
      const root = site()
      const publishDir = join(root, '.hadley', 'publish')

      // Build directly to publish/ (no intermediate preview/ directory)
      const serve = await serving(root)
      if (hasBuildFlag) await build(root, 'publish') // production URLs
      else await build(root, 'publish', { localServer: true }) // comments go to the local server

      console.log(`\n✅ Published → ${publishDir}/`)

      if (!hasBuildFlag) {
        await startDevServer({ siteDir: root, outputMode: 'publish', serve, noWatch: true, noBuild: true })
      }
      break
    }

    case 'comments': {
      const root = site()
      const { runCommentsCli } = await import('./addons/forms/index.ts')
      await runCommentsCli(root, { dev: false })
      break
    }

    case 'clean': {
      const root = site()
      const dirs = ['dev', 'publish', 'cache']
      for (const dir of dirs) {
        await rm(join(root, '.hadley', dir), { recursive: true, force: true })
        await mkdir(join(root, '.hadley', dir), { recursive: true })
      }
      console.log(`🧹 ${siteLabel(root, await siteConfig(root))} — ${dirs.join(', ')} cleared`)
      break
    }

    case 'version': {
      console.log(`hadley ${pkg.version}`)
      break
    }

    default: {
      fail(`hadley has no command ${command}: init, dev, deploy, clean, comments, version (hadley --help)`)
    }
  }
} catch (error) {
  fail(error)
}
