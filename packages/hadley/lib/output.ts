// Every file a build writes into its output directory belongs to one owner: a page, one of a page's files, the site
// (sitemap, feed, llms.txt, …) or the theme; a directory may belong to one owner as a whole (the search index). A
// second owner of a path stops the build with both named, so nothing hadley writes silently replaces something else
// it wrote. The build claims every page, theme and site file before it builds anything (index.ts), and a page's own
// files as it builds them, before any page is rendered; list() is then everything the output directory holds. Paths
// inside it are written with `/` on every system, as a URL names them; only claim() gives one of the file system.
// Two paths that differ only in case or in Unicode normalisation stop the build too, and so does a segment in the
// form of a Windows short name (`PROGRA~1`): macOS or Windows could write them as one.

import { join } from 'node:path'
import { dirname, isAbsolute, join as joinInside, relative } from 'node:path/posix'

// where #inside resolves a path, so `..` that leaves the output directory stays visible
const ROOT = '/output'
// the 8.3 name Windows may give a file or directory as a second name: up to six characters, ~ and a number
const SHORT_NAME = /^[^~.]{1,6}~\d{1,6}(?:\.[^.]{1,3})?$/
const folded = (path: string) => path.normalize('NFC').toLowerCase()

export class Output {
  readonly #files = new Map<string, string>()
  readonly #directories = new Map<string, string>()
  // every directory a claimed file or directory lies in, with the owner of the first one claimed there
  readonly #parents = new Map<string, string>()
  // every claimed path and directory above one, by its lower case in NFC, as it was first spelled, with its owner
  readonly #spelled = new Map<string, { path: string; owner: string }>()
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /**
   * The path of the file `rel` inside the output directory, claimed for `owner`. The same owner may claim a path
   * again; a path outside the output directory, one another owner holds, and a file where a directory must be (or
   * the other way round) are errors.
   */
  claim(rel: string, owner: string): string {
    const inside = this.#inside(rel, owner)
    const directory = this.#directories.get(inside)
    if (directory !== undefined) throw new Error(`${inside} is a directory of ${directory} and a file of ${owner}`)
    const held = this.#files.get(inside) ?? this.#directoryOf(inside)
    if (held !== undefined && held !== owner) throw new Error(`${inside} is written by both ${held} and ${owner}`)
    this.#asFile(inside, owner)
    this.#files.set(inside, owner)
    this.#addParents(inside, owner)
    return join(this.dir, inside)
  }

  /** The directory `rel` and everything in it, claimed for `owner` alone. */
  claimDirectory(rel: string, owner: string): string {
    const inside = this.#inside(rel, owner)
    // every path already claimed in it, not only the first, must be the owner's
    const held =
      this.#directoryOf(inside) ??
      [...this.#files, ...this.#directories].find(([path, by]) => path.startsWith(`${inside}/`) && by !== owner)?.[1]
    if (held !== undefined && held !== owner) throw new Error(`${inside}/ is written by both ${held} and ${owner}`)
    const file = this.#files.get(inside)
    if (file !== undefined) throw new Error(`${inside} is a file of ${file} and a directory of ${owner}`)
    this.#noFileAbove(inside, owner)
    this.#directories.set(inside, owner)
    this.#addParents(inside, owner)
    return join(this.dir, inside)
  }

  /**
   * Whether the build writes the file `rel` as a file it claimed. A file inside a claimed directory is not one: what a
   * tool writes there (the search index) is the tool's to name.
   */
  writesFile(rel: string): boolean {
    // as claimed, not normalised: `a//index.html` names no file `a/index.html` does
    return this.#files.has(rel)
  }

  /** Every claimed file, and every claimed directory with a trailing `/`, sorted. */
  list(): string[] {
    return [...this.#files.keys(), ...[...this.#directories.keys()].map((dir) => `${dir}/`)].sort()
  }

  #inside(rel: string, owner: string): string {
    // a backslash is a separator on Windows, so no system may take it for part of a name
    if (rel.includes('\\')) throw new Error(`${owner}: ${rel} names a path with a backslash`)
    const inside = relative(ROOT, joinInside(ROOT, rel))
    if (inside === '' || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) {
      throw new Error(`${owner}: ${rel} leaves ${this.dir}`)
    }
    const short = inside.split('/').find((segment) => SHORT_NAME.test(segment))
    if (short !== undefined)
      throw new Error(`${owner}: ${rel} has a segment in the form of a Windows short name: ${short}`)
    this.#sameSpelling(inside, owner)
    return inside
  }

  // `inside` and each directory above it spelled as any other claimed path that differs from it only in case or form
  #sameSpelling(inside: string, owner: string): void {
    const paths: string[] = []
    for (let path = inside; path !== '.'; path = dirname(path)) paths.push(path)
    for (const path of paths) {
      const spelled = this.#spelled.get(folded(path))
      if (spelled !== undefined && spelled.path !== path) {
        throw new Error(`${path} of ${owner} and ${spelled.path} of ${spelled.owner} differ only in case`)
      }
    }
    for (const path of paths) if (!this.#spelled.has(folded(path))) this.#spelled.set(folded(path), { path, owner })
  }

  // a file cannot be where a claimed path needs a directory, nor lie in a claimed file
  #asFile(inside: string, owner: string): void {
    const below = this.#parents.get(inside)
    if (below !== undefined) throw new Error(`${inside} is a file of ${owner} and a directory of ${below}`)
    this.#noFileAbove(inside, owner)
  }

  #noFileAbove(inside: string, owner: string): void {
    for (let dir = dirname(inside); dir !== '.'; dir = dirname(dir)) {
      const file = this.#files.get(dir)
      if (file !== undefined) throw new Error(`${dir} is a file of ${file} and a directory of ${owner}`)
    }
  }

  #addParents(inside: string, owner: string): void {
    for (let dir = dirname(inside); dir !== '.' && !this.#parents.has(dir); dir = dirname(dir)) {
      this.#parents.set(dir, owner)
    }
  }

  // the owner of a claimed directory that holds `inside`, or is it
  #directoryOf(inside: string): string | undefined {
    for (const [dir, owner] of this.#directories) {
      if (inside === dir || inside.startsWith(`${dir}/`)) return owner
    }
    return undefined
  }
}
