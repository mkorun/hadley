#!/usr/bin/env bun
/**
 * Builds the same sites with two hadley checkouts and compares the publish output byte for byte.
 *
 *   bun scripts/compare-builds.ts --ref <checkout> [--candidate <checkout>] [--sites <dir>] [--candidate-sites <dir>]
 *                                 [--keep] [site…]
 *
 * --ref        the checkout to compare against (e.g. the production checkout)
 * --candidate  the checkout under test; default: this repository
 * --sites      directory holding one directory (or symlink) per site; default: sites/ of this repository
 * --candidate-sites  the sites the candidate builds, e.g. copies with a patch the ref cannot read; default: --sites
 * --keep       keep the temporary build directories and print their path
 *
 * Neither checkout nor any site is written to: every build runs with its own temporary working directory that holds
 * a copy of the site, so all output and caches stay there. The copy leaves out .hadley/, .git/ and dist at the root
 * of the site only; any other symlink in a site is an error, because a copy would still reach its target. Compared
 * are every file under .hadley/publish/ (except the search index publish/pagefind/), .hadley/meta.json and
 * .hadley/links.json; a symlink or any other non-regular file in the output is an error.
 *
 * Exit status: 0 identical, 1 differences, 2 usage error, failed build or any other failure.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const SITE_ROOT_SKIP = new Set(['.hadley', '.git', 'dist'])
const USAGE =
  'usage: bun scripts/compare-builds.ts --ref <checkout> [--candidate <checkout>] [--sites <dir>] [--candidate-sites <dir>] [--keep] [site…]'

export class UsageError extends Error {}

export interface Options {
  ref: string
  candidate: string
  sitesDir: string
  candidateSitesDir: string
  keep: boolean
  sites: string[]
}

/** A site name is one path component: letters, digits, dots, hyphens, underscores; it starts with a letter or digit. */
export function isSiteName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
}

/** The command line of `checkout`: packages/hadley/hadley.ts, or hadley.ts in a checkout from before that layout. */
export function entryOf(checkout: string): string | null {
  for (const entry of [join(checkout, 'packages', 'hadley', 'hadley.ts'), join(checkout, 'hadley.ts')])
    if (existsSync(entry)) return entry
  return null
}

export function parseArgs(argv: string[], repoRoot: string): Options {
  let ref = ''
  let candidate = repoRoot
  let sitesDir = join(repoRoot, 'sites')
  let candidateSitesDir = ''
  let keep = false
  const sites: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const value = () => {
      const v = argv[++i]
      if (!v) throw new UsageError(`${arg} needs a value`)
      return v
    }
    if (arg === '--ref') ref = resolve(value())
    else if (arg === '--candidate') candidate = resolve(value())
    else if (arg === '--sites') sitesDir = resolve(value())
    else if (arg === '--candidate-sites') candidateSitesDir = resolve(value())
    else if (arg === '--keep') keep = true
    else if (arg.startsWith('--')) throw new UsageError(`unknown option ${arg}`)
    else sites.push(arg)
  }
  if (!ref) throw new UsageError('--ref is required')
  for (const checkout of [ref, candidate]) {
    if (!entryOf(checkout)) throw new UsageError(`not a hadley checkout (no hadley.ts): ${checkout}`)
  }
  candidateSitesDir ||= sitesDir
  for (const dir of new Set([sitesDir, candidateSitesDir])) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`sites directory not found: ${dir}`)
  }
  if (sites.length === 0) sites.push(...readdirSync(sitesDir).sort())
  if (sites.length === 0) throw new UsageError(`no sites in ${sitesDir}`)
  for (const site of sites) {
    if (!isSiteName(site)) throw new UsageError(`not a site name (one path component expected): ${site}`)
    for (const dir of new Set([sitesDir, candidateSitesDir])) {
      if (!existsSync(join(dir, site, 'config.lima'))) {
        throw new UsageError(`not a site (no config.lima): ${join(dir, site)}`)
      }
    }
  }
  return { ref, candidate, sitesDir, candidateSitesDir, keep, sites }
}

/** Copies a site without .hadley/, .git/ and dist at its root; any other symlink stops the copy. */
export function copySite(source: string, destination: string): void {
  const siteRoot = realpathSync(source)
  cpSync(siteRoot, destination, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const rel = relative(siteRoot, path)
      if (SITE_ROOT_SKIP.has(rel)) return false
      if (rel !== '' && lstatSync(path).isSymbolicLink()) throw new Error(`symlink inside the site: ${path}`)
      return true
    },
  })
}

/** Maps each output path, relative to .hadley/, to the SHA-256 of its bytes. */
export function collectOutput(hadleyDir: string): Map<string, string> {
  const files = new Map<string, string>()
  const add = (file: string) => {
    files.set(relative(hadleyDir, file), createHash('sha256').update(readFileSync(file)).digest('hex'))
  }
  const publish = join(hadleyDir, 'publish')
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const kind = lstatSync(path)
      if (kind.isDirectory()) {
        if (!(dir === publish && name === 'pagefind')) walk(path)
      } else if (kind.isFile()) {
        add(path)
      } else {
        throw new Error(`not a regular file in the output: ${path}`)
      }
    }
  }
  walk(publish)
  for (const name of ['meta.json', 'links.json']) {
    const path = join(hadleyDir, name)
    if (!existsSync(path)) continue
    if (!lstatSync(path).isFile()) throw new Error(`not a regular file in the output: ${path}`)
    add(path)
  }
  return files
}

export function compareOutputs(ref: Map<string, string>, candidate: Map<string, string>): string[] {
  const findings: string[] = []
  for (const [path, hash] of ref) {
    if (!candidate.has(path)) findings.push(`only in ref:       ${path}`)
    else if (candidate.get(path) !== hash) findings.push(`differs:           ${path}`)
  }
  for (const path of candidate.keys()) {
    if (!ref.has(path)) findings.push(`only in candidate: ${path}`)
  }
  return findings.sort()
}

/** Builds `site` with `checkout` in `workDir`; returns the site's .hadley directory. */
function build(checkout: string, sitesDir: string, site: string, workDir: string): string {
  const siteDir = join(workDir, 'sites', site)
  if (!resolve(siteDir).startsWith(resolve(workDir) + sep))
    throw new Error(`site path leaves the work directory: ${site}`)
  copySite(join(sitesDir, site), siteDir)
  const result = spawnSync('bun', [entryOf(checkout)!, 'deploy', '--build'], {
    cwd: workDir,
    // HADLEY_ROOT names the site to hadley since it runs in the site's directory, HADLEY_SITE to a ref from before
    env: { ...process.env, HADLEY_ROOT: siteDir, HADLEY_SITE: site, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
  })
  writeFileSync(join(workDir, 'build.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (result.status !== 0) {
    const cause = result.error ? result.error.message : `exit status ${result.status}`
    throw new Error(`build of ${site} with ${checkout} failed (${cause}); log: ${join(workDir, 'build.log')}`)
  }
  return join(siteDir, '.hadley')
}

export function main(argv: string[]): number {
  let options: Options
  try {
    options = parseArgs(argv, resolve(dirname(import.meta.filename), '..'))
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`compare-builds: ${error.message}\n${USAGE}`)
    return 2
  }
  console.log(`ref:       ${options.ref}`)
  console.log(`candidate: ${options.candidate}`)
  let root = ''
  let differences = 0
  let failed = false
  try {
    root = mkdtempSync(join(tmpdir(), 'hadley-compare-'))
    for (const site of options.sites) {
      const refDir = join(root, site, 'ref')
      const candidateDir = join(root, site, 'candidate')
      mkdirSync(refDir, { recursive: true })
      mkdirSync(candidateDir, { recursive: true })
      const started = Date.now()
      const refFiles = collectOutput(build(options.ref, options.sitesDir, site, refDir))
      const candidateFiles = collectOutput(build(options.candidate, options.candidateSitesDir, site, candidateDir))
      const findings = compareOutputs(refFiles, candidateFiles)
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      if (findings.length === 0) {
        console.log(`✓ ${site}: ${refFiles.size} files identical (${seconds} s)`)
      } else {
        differences += findings.length
        console.log(`✗ ${site}: ${findings.length} of ${refFiles.size} files differ (${seconds} s)`)
        for (const finding of findings) console.log(`    ${finding}`)
      }
    }
  } catch (error) {
    failed = true
    console.error(`compare-builds: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (root && (options.keep || failed)) {
      console.log(`kept: ${root}`)
    } else if (root) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch (error) {
        failed = true
        console.error(`compare-builds: could not remove ${root}: ${error instanceof Error ? error.message : error}`)
      }
    }
  }
  return failed ? 2 : differences > 0 ? 1 : 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
