#!/usr/bin/env bun
/**
 * The smoke test (release plan, steps 0.7 and 1.9): what a new user does first, on a fresh clone of this repository at
 * its HEAD commit. It installs the dependencies from the lockfile, makes a small site (a home page, an article with an
 * image, a feed), builds it with `hadley dev --build` below the site's directory and `hadley deploy --build --root
 * <site>` beside it, and checks that each build exits 0 and writes the files a reader gets; in between it starts
 * `hadley dev` in the site's directory, loads what a browser loads first, and changes a page, which must make one build
 * and show on the page. It does so four times: with hadley from
 * the clone on Bun and on Node.js, and with the package scripts/pack.ts builds, packed and installed with npm into a
 * project of its own, on Node.js and on Bun. Needs `node` and `npm` on the PATH, and the npm registry. With --binary it
 * does so once and with nothing else: with a program scripts/build-binary.ts built.
 *
 *   bun scripts/smoke.ts [--keep] [--binary <program>]
 *
 * --keep    keep the temporary directory and print its path
 * --binary  try this program of a release instead of the clone and the package
 *
 * Uncommitted changes are not in a fresh clone, so they are not tested. Exit status: 0 the site builds, 1 a step
 * failed, 2 usage error.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const USAGE = 'usage: bun scripts/smoke.ts [--keep] [--binary <program>]'

// a PNG of one pixel, so that the image pipeline (sharp) runs without a file of the repository
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** The files of the site, by their path in it. */
export const SITE: Record<string, string> = {
  'config.lima': `site:
  origin: https://smoke.example
  default:
    language: en
    title: Smoke
rss:
  enabled: true
`,
  'theme/templates/home.chase': `<!DOCTYPE html>
<html lang="{ meta.lang }">
<head><meta charset="utf-8"><title>{ htmlTitle }</title></head>
<body>
<h1>{ meta.title }</h1>
<ul>{#each articleList as item}<li><a href="{ item.urlPath }">{ item.title }</a></li>{/each}</ul>
{@raw html.markup}
</body>
</html>
`,
  'theme/templates/article.chase': `<galley:config>{"images":{"default":{"widths":[480],"formats":["webp"],"sizes":"100vw","quality":80}}}</galley:config>
<!DOCTYPE html>
<html lang="{ meta.lang }">
<head><meta charset="utf-8"><title>{ htmlTitle }</title><meta name="description" content="{ meta.description }"></head>
<body>
<h1>{ meta.title }</h1>
{@raw html.markup}
</body>
</html>
`,
  'theme/assets/css/style.css': 'body { margin: 0 }\n',
  'content/pages/[home]/home.md': `---
urlPath: /
template: home
---
# Smoke

A site to see hadley build.
`,
  'content/articles/[hello]/hello.md': `---
publishFrom: 2026-01-01
description: The first article.
---
# Hello

Some text, and a picture.

![A pixel](pixel.png)
`,
}

/** The files the two builds must write, by their path in the site. */
export const EXPECTED = [
  '.hadley/dev/index.html',
  '.hadley/dev/hello/index.html',
  '.hadley/publish/index.html',
  '.hadley/publish/hello/index.html',
  '.hadley/publish/hello/pixel-1w.webp',
  '.hadley/publish/sitemap.xml',
  '.hadley/publish/feed.xml',
]

// the port of the dev server (and the next one, its comments service's), unlikely to be taken
const PORT = 8790
// what hadley dev says without a terminal when it has nothing to do; what the smoke test adds to a page
const IDLE = '(no keyboard: not a terminal)'
const CHANGED = 'Changed by the smoke test.'

/** What the dev server must answer, by path: pages, a stylesheet of the theme, an image, a page there is not. */
export const SERVED: [path: string, status: number][] = [
  ['/', 200],
  ['/hello/', 200],
  ['/assets/css/style.css', 200],
  ['/hello/pixel-1w.webp', 200],
  ['/missing/', 404],
  // the block editor is off without dev.editor in config.lima
  ['/__hadley/editor.js', 404],
]

type Step = { name: string; command: string; args: string[]; cwd: string; timeout: number }

// without a HADLEY_ROOT of the caller's, which would name the site instead of the smoke test
const { HADLEY_ROOT: _, ...env } = process.env

function run(step: Step): void {
  const started = performance.now()
  const result = spawnSync(step.command, step.args, { cwd: step.cwd, env, encoding: 'utf-8', timeout: step.timeout })
  const ms = Math.round(performance.now() - started)
  if (result.error || result.status !== 0) {
    const why = result.error ? result.error.message : `exit ${result.status}`
    console.error(`✗ ${step.name} (${ms} ms): ${why}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
    throw new SmokeFailure()
  }
  console.log(`✓ ${step.name} (${ms} ms)`)
}

class SmokeFailure extends Error {}

/**
 * Changes the article once the first build is over, and adds to `wrong` if the page does not show it or the server
 * builds anything but once for it. hadley writes the line IDLE when it starts and after each build.
 */
async function changePage(
  site: string,
  log: () => string,
  deadline: number,
  server: ChildProcess,
  wrong: string[],
): Promise<void> {
  const count = (text: string) => log().split(text).length - 1
  const built = () => count(IDLE) - 1 === count('Rebuilding (')
  const until = async (done: () => boolean | Promise<boolean>) => {
    while (Date.now() < deadline && server.exitCode === null) {
      if (await done()) return true
      await new Promise((wait) => setTimeout(wait, 100))
    }
    return false
  }
  if (!(await until(built))) {
    wrong.push('the first build did not end')
    return
  }
  appendFileSync(join(site, 'content', 'articles', '[hello]', 'hello.md'), `\n${CHANGED}\n`)
  const shown = await until(() =>
    fetch(`http://localhost:${PORT}/hello/`, { signal: AbortSignal.timeout(5_000) }).then(
      async (response) => (await response.text()).includes(CHANGED),
      () => false,
    ),
  )
  if (!shown) {
    wrong.push('the change of a page did not show')
    return
  }
  await until(built)
  // a second build, for what the first one wrote or read, would start now
  await new Promise((wait) => setTimeout(wait, 1_500))
  const builds = count('Rebuilding (') - 1
  if (builds !== 1) wrong.push(`a change of a page made ${builds} builds, not one`)
}

/**
 * Starts `hadley dev` in `site` and asks it for each path of SERVED until it answers as expected (the first build is
 * written while Vite already runs) or a minute is over; then changes a page, and expects it to show after one build.
 * Then it stops the server.
 */
async function serve(hadley: Hadley, site: string): Promise<void> {
  const started = performance.now()
  const server = spawn(hadley.command, [...hadley.args, 'dev', '--port', String(PORT)], { cwd: site, env })
  let log = ''
  server.stdout.on('data', (chunk) => (log += chunk))
  server.stderr.on('data', (chunk) => (log += chunk))
  const exited = new Promise((done) => server.once('exit', done))
  const deadline = Date.now() + 60_000
  const wrong: string[] = []
  try {
    for (const [path, status] of SERVED) {
      let got: number | string = 'not asked, the minute was over'
      while (got !== status && Date.now() < deadline && server.exitCode === null) {
        got = await fetch(`http://localhost:${PORT}${path}`, { signal: AbortSignal.timeout(5_000) }).then(
          (response) => response.status,
          () => 'no answer',
        )
        if (got !== status) await new Promise((wait) => setTimeout(wait, 250))
      }
      if (got !== status) wrong.push(`${path}: ${got}, not ${status}`)
    }
    if (wrong.length === 0) await changePage(site, () => log, deadline, server, wrong)
  } finally {
    // on Windows a program of a release is a process with hadley below it, and a signal reaches only the first
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { timeout: 10_000 })
    else server.kill('SIGTERM')
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise((wait) => setTimeout(wait, 10_000, false)),
    ])
    if (!stopped) server.kill('SIGKILL')
  }
  const ms = Math.round(performance.now() - started)
  if (wrong.length > 0) {
    console.error(`✗ hadley dev (${ms} ms): ${wrong.join('; ')}\n${log}`)
    throw new SmokeFailure()
  }
  console.log(`✓ hadley dev serves ${SERVED.length} paths as expected (${ms} ms)`)
}

/** A way to run hadley: what it is, the program, and the arguments before hadley's own. */
type Hadley = { name: string; command: string; args: string[] }

/**
 * Makes the small site in `site` and builds it with `hadley`: `hadley dev --build` below the site's directory, the dev
 * server, `hadley deploy --build --root <site>` beside it; then checks the files a reader gets.
 */
async function smokeSite(site: string, hadley: Hadley): Promise<void> {
  console.log(`— ${hadley.name}`)
  for (const [path, text] of Object.entries(SITE)) {
    mkdirSync(dirname(join(site, path)), { recursive: true })
    writeFileSync(join(site, path), text)
  }
  writeFileSync(join(site, 'content', 'articles', '[hello]', 'pixel.png'), PIXEL)
  run({
    name: 'hadley dev --build',
    command: hadley.command,
    args: [...hadley.args, 'dev', '--build'],
    cwd: join(site, 'content', 'articles'),
    timeout: 120_000,
  })
  await serve(hadley, site)
  run({
    name: 'hadley deploy --build',
    command: hadley.command,
    args: [...hadley.args, 'deploy', '--build', '--root', site],
    cwd: dirname(site),
    timeout: 120_000,
  })
  const missing = EXPECTED.filter((path) => !existsSync(join(site, path)))
  const home = readFileSync(join(site, '.hadley', 'publish', 'index.html'), 'utf-8')
  if (!home.includes('href="/hello/"')) missing.push('a link from the home page to /hello/')
  if (missing.length > 0) {
    console.error(`✗ the builds did not write: ${missing.join(', ')}`)
    throw new SmokeFailure()
  }
  console.log(`✓ the site builds: ${EXPECTED.length} files and the link to the article are there`)
}

async function main(args: string[]): Promise<number> {
  const keep = args.includes('--keep')
  const rest = args.filter((arg) => arg !== '--keep')
  const binary = rest[0] === '--binary' && rest.length === 2 ? resolve(rest[1]!) : undefined
  if (rest.length > 0 && !binary) {
    console.error(USAGE)
    return 2
  }
  const repo = join(import.meta.dir, '..')
  const git = (gitArgs: string[]) =>
    spawnSync('git', gitArgs, { cwd: repo, encoding: 'utf-8', timeout: 30_000 }).stdout.trim()
  const head = git(['rev-parse', 'HEAD'])
  if (!head) {
    console.error('smoke: this is no git repository')
    return 1
  }
  if (!binary && git(['status', '--porcelain']))
    console.log('(uncommitted changes are not in a fresh clone, so not tested)')

  // the temporary directory by its long name: below a Windows short name (C:\Users\RUNNER~1), bun install
  // --frozen-lockfile finds changes in a lockfile that has none. A program installs nothing, and is tried below it.
  const root = mkdtempSync(join(binary ? tmpdir() : realpathSync.native(tmpdir()), 'hadley-smoke-'))
  const clone = join(root, 'hadley')
  const bun = process.execPath
  try {
    if (binary) {
      await smokeSite(join(root, 'program'), { name: 'the program', command: binary, args: [] })
      return 0
    }
    run({
      name: `clone ${head.slice(0, 7)}`,
      command: 'git',
      args: ['clone', '--quiet', '--no-local', repo, clone],
      cwd: root,
      timeout: 120_000,
    })
    run({
      name: 'check out the commit',
      command: 'git',
      args: ['checkout', '--quiet', head],
      cwd: clone,
      timeout: 30_000,
    })
    run({
      name: 'bun install --frozen-lockfile',
      command: bun,
      args: ['install', '--frozen-lockfile'],
      cwd: clone,
      timeout: 300_000,
    })

    // hadley from the clone, as a checkout runs it, on both runtimes (docs/adr/0001-runtimes.md)
    const source = join(clone, 'packages', 'hadley', 'hadley.ts')
    await smokeSite(join(root, 'bun'), { name: 'the clone on Bun', command: bun, args: [source] })
    await smokeSite(join(root, 'node'), { name: 'the clone on Node.js', command: 'node', args: [source] })

    // hadley as a user installs it: the package scripts/pack.ts builds, packed and installed with npm
    run({ name: 'bun scripts/pack.ts', command: bun, args: ['scripts/pack.ts'], cwd: clone, timeout: 300_000 })
    run({
      name: 'npm pack',
      command: 'npm',
      args: ['pack', '--pack-destination', root],
      cwd: join(clone, 'dist'),
      timeout: 120_000,
    })
    const project = join(root, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'package.json'), '{ "private": true, "type": "module" }\n')
    const tarball = readdirSync(root).find((name) => name.endsWith('.tgz'))!
    run({
      name: 'npm install the package',
      command: 'npm',
      args: ['install', '--no-audit', '--no-fund', join(root, tarball)],
      cwd: project,
      timeout: 300_000,
    })
    const installed = join(project, 'node_modules', '@mkorun', 'hadley', 'hadley.js')
    await smokeSite(join(root, 'package-node'), { name: 'the package on Node.js', command: 'node', args: [installed] })
    await smokeSite(join(root, 'package-bun'), { name: 'the package on Bun', command: bun, args: [installed] })
    return 0
  } catch (error) {
    if (error instanceof SmokeFailure) return 1
    throw error
  } finally {
    if (keep) console.log(`kept: ${root}`)
    else rmSync(root, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
