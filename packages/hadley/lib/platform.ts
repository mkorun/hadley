/**
 * What differs between Linux, macOS and Windows, in one place (docs/platforms.md): the separator of a path the file
 * system gives, the files an operating system leaves, names that macOS and Windows find in any case, how a program
 * is found on the PATH, and whether a file's mode can say who may read it. Everything else in hadley names paths
 * with `/`, as URLs and the output directory do.
 */
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { delimiter, isAbsolute, join, sep } from 'node:path'

const windows = process.platform === 'win32'
// the file systems macOS and Windows make by default find a name in any case
const caseBlind = windows || process.platform === 'darwin'

/** A relative path as the file system gives it (readdir, relative), with `/` between its segments. */
export const slashed = (path: string, separator: string = sep): string =>
  separator === '/' ? path : path.split(separator).join('/')

/**
 * Every path below `dir`, files and directories, with `/`. Read below the directory's real path: Bun on Windows reads
 * nothing below a directory it is given as a junction, a link the owner may have made (AGENTS.md, "Security").
 */
export const pathsBelow = async (dir: string): Promise<string[]> =>
  (await readdir(realpathSync(dir), { recursive: true })).map((path) => slashed(path))

/** Whether the file at `path` was written at or after `time` (milliseconds), or is gone. */
export function changedSince(path: string, time: number): boolean {
  try {
    return statSync(path).mtimeMs >= time
  } catch {
    return true
  }
}

/**
 * Whether `name` is a file an operating system leaves in a directory, which hadley neither reads nor publishes:
 * `.DS_Store` and `._*` (macOS), `Thumbs.db` and `desktop.ini` (Windows).
 */
export const isSystemFile = (name: string): boolean =>
  name === '.DS_Store' || name.startsWith('._') || /^(?:thumbs\.db|desktop\.ini)$/i.test(name)

/**
 * Whether `rel` (with `/`) exists below `dir` spelled exactly so. Linux tells by the name alone; on macOS and
 * Windows every segment is compared, in NFC, with the names its directory holds, so a site that builds there builds
 * on Linux.
 */
export function existsExactly(dir: string, rel: string, { blind = caseBlind }: { blind?: boolean } = {}): boolean {
  if (!existsSync(join(dir, rel))) return false
  if (!blind) return true
  let at = dir
  for (const segment of rel.split('/')) {
    const named = segment.normalize('NFC')
    if (segment !== '' && segment !== '.' && segment !== '..') {
      if (!readdirSync(at).some((name) => name.normalize('NFC') === named)) return false
    }
    at = join(at, segment)
  }
  return true
}

/** Text as it is read, with the line ends of Windows (`\r\n`) as `\n`. */
export const lf = (text: string): string => text.replace(/\r\n/g, '\n')

/** Whether `path` is a file that can be run: on Windows, one that exists. */
export const isProgram = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The program `name` in the first absolute directory of `path` (the PATH) that has it, as an absolute path;
 * undefined when none has. On Windows the program is `name.exe`. A relative directory is skipped: it would name a
 * program of the directory hadley runs in.
 */
export function onPath(name: string, path: string = process.env.PATH ?? ''): string | undefined {
  const file = windows ? `${name}.exe` : name
  for (const dir of path.split(delimiter)) if (isAbsolute(dir) && isProgram(join(dir, file))) return join(dir, file)
  return undefined
}

/**
 * Whether a file of `mode` can be read by others than its owner. Windows keeps no such mode (Node reports every
 * file as 0o666); there the file's place under the user's own directory is what keeps it private.
 */
export const readableByOthers = (mode: number, { onWindows = windows }: { onWindows?: boolean } = {}): boolean =>
  !onWindows && (mode & 0o077) !== 0
