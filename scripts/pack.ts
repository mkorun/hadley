#!/usr/bin/env bun
/**
 * Builds the package to publish (docs/adr/0001-runtimes.md) in dist/: tsc compiles the sources to JavaScript with
 * declarations, the files that are not TypeScript and the licence are copied beside them, and dist/package.json is the
 * manifest of packages/hadley with its command line pointed at the JavaScript, which starts with Node.js. A checkout
 * runs from its sources; only a publish uses dist/.
 *
 *   bun scripts/pack.ts
 *
 * Exit status: 0 built, 1 tsc failed.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TSC_TIMEOUT_MS = 5 * 60 * 1000
const repo = join(import.meta.dirname, '..')
const source = join(repo, 'packages', 'hadley')
export const DIST = join(repo, 'dist')

/** What tsc compiles: the command line and the library, and all they import, dynamically too. */
const ENTRIES = ['hadley.ts', 'index.ts']

/** The files beside the sources a module reads at run time, by their path in the package (lib/init.ts, the editor). */
export const FILES = ['addons/editor/assets', 'starters', 'themes']

/** The files of the repository the package carries, by their path in both. */
const REPOSITORY_FILES = ['LICENSE']

/** The Markdown files of the repository the package carries, its links made to lead to the repository (forNpm). */
const REPOSITORY_TEXTS = ['README.md', 'CHANGELOG.md']

/** The manifest of the published package: that of packages/hadley, with the command line in JavaScript. */
export function manifest(sourceManifest: { bin: Record<string, string> } & Record<string, unknown>) {
  const bin = Object.fromEntries(Object.entries(sourceManifest.bin).map(([name, file]) => [name, toJs(file)]))
  return { ...sourceManifest, bin }
}

const toJs = (file: string) => file.replace(/\.ts$/, '.js')

/**
 * `text` with its relative links leading to the file in the repository on GitHub, as npm shows a package's README
 * without the repository around it: `docs/config.md` becomes `<repository>/blob/main/docs/config.md`. A link with a
 * scheme, to an anchor or to a path of a site stays as it is.
 */
export const forNpm = (text: string, repository: string): string =>
  text.replace(/\]\(([^)\s]+)\)/g, (link, path: string) =>
    /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(path) ? link : `](${repository}/blob/main/${path})`,
  )

/** The repository of a manifest on GitHub as a web address: git+https://github.com/o/r.git, https://github.com/o/r. */
export const repositoryUrl = (manifest: Record<string, unknown>): string => {
  const url = (manifest.repository as { url?: unknown } | undefined)?.url
  const match =
    typeof url === 'string' ? /^(?:git\+)?(https:\/\/github\.com\/[^/]+\/[^/.]+)(?:\.git)?$/.exec(url) : null
  if (!match) throw new Error('packages/hadley/package.json: repository.url is no repository on GitHub')
  return match[1]!
}

/** `text` with the interpreter line of a command line for Node.js, whichever it named. */
export const forNode = (text: string) => text.replace(/^#!.*\n/, '#!/usr/bin/env node\n')

export function main(): number {
  rmSync(DIST, { recursive: true, force: true })
  // tsconfig.json is for checking; these options compile the same sources
  const tsc = spawnSync(
    join(repo, 'node_modules', '.bin', 'tsc'),
    [
      '--ignoreConfig',
      ...ENTRIES.map((entry) => join(source, entry)),
      ['--rootDir', source],
      ['--outDir', DIST],
      ['--module', 'ESNext'],
      ['--moduleResolution', 'bundler'],
      ['--target', 'esnext'],
      ['--lib', 'esnext'],
      ['--types', 'node'],
      '--strict',
      '--exactOptionalPropertyTypes',
      '--erasableSyntaxOnly',
      '--verbatimModuleSyntax',
      '--skipLibCheck',
      '--resolveJsonModule',
      '--allowImportingTsExtensions',
      '--rewriteRelativeImportExtensions',
      '--declaration',
      '--noEmitOnError',
    ].flat(),
    { stdio: 'inherit', timeout: TSC_TIMEOUT_MS },
  )
  if (tsc.status !== 0) {
    console.error(`tsc failed (${tsc.error?.message ?? `exit status ${tsc.status}`})`)
    return 1
  }
  for (const path of FILES) cpSync(join(source, path), join(DIST, path), { recursive: true })
  for (const path of REPOSITORY_FILES) cpSync(join(repo, path), join(DIST, path))
  const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const repository = repositoryUrl(sourceManifest)
  for (const path of REPOSITORY_TEXTS)
    writeFileSync(join(DIST, path), forNpm(readFileSync(join(repo, path), 'utf8'), repository))
  const published = manifest(sourceManifest)
  writeFileSync(join(DIST, 'package.json'), JSON.stringify(published, null, 2) + '\n')
  for (const file of Object.values(published.bin)) {
    const path = join(DIST, file)
    writeFileSync(path, forNode(readFileSync(path, 'utf8')))
  }
  console.log(`built ${DIST}`)
  return 0
}

if (import.meta.main) process.exit(main())
