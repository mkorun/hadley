/**
 * A picture added to a page's bundle (browser/features/pictures.ts), and the files the editor wrote or took away
 * itself, whose change rebuilds nothing.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { statSync } from 'node:fs'
import { link, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { IMAGE_SECONDS, located, pngUnpacksWithin } from '../../lib/images.ts'
import { lookupDirs } from '../../lib/site-paths.ts'
import { blockIdMap } from './blocks.ts'
import { imageType } from './bundle.ts'
import { getLang, readBytes, send } from './http.ts'
import { t } from './i18n.ts'

/** How large a picture the editor adds may be, and how far what a PNG holds packed may unpack. */
const PICTURE_BYTES = 25 * 1024 * 1024
const PICTURE_UNPACKED = 8 * 1024 * 1024
// a name a picture is added under: one file, of letters, digits, `-`, `_` and `.`, not hidden or private, PNG or JPEG
const PICTURE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*\.(?:png|jpe?g)$/u
// a name Windows keeps for a device, with any extension (lib/site-paths.ts, urlPathProblem)
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** Whether a picture may be added under `name`: the rules above, at most 100 characters, in NFC. */
export const pictureName = (name: string): boolean =>
  name.length <= 100 && name === name.normalize('NFC') && PICTURE_NAME.test(name) && !DEVICE_NAME.test(name)

/**
 * The file of a page whose name is `name` but for its case, where the build would find it (lookupDirs), and whether it
 * is a plain file: a system that does not tell `Photo.png` from `photo.png` would take one for the other.
 */
async function takenName(
  dirs: string[],
  name: string,
): Promise<{ name: string; path: string; plain: boolean } | undefined> {
  const wanted = name.toLowerCase()
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const entry = entries.find((each) => each.name.normalize('NFC').toLowerCase() === wanted)
    if (entry) return { name: entry.name, path: join(dir, entry.name), plain: entry.isFile() }
  }
  return undefined
}

/**
 * Adds a PNG or JPEG to the bundle of a block's page, as it is, under the name the editor gives it: in the bundle's
 * folder, or in place of the file of that name the page takes (`replace=1`), never through a link. It answers 409 with
 * the name taken, whatever its case, and says whether the picture holds where it was taken (`located`), which the site
 * publishes without (docs/content.md, "Pictures").
 */
export async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lang = getLang(req)
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  const entry = blockIdMap.get(query.get('block') ?? '')
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  const dirs = lookupDirs(entry.filePath)
  if (dirs.length === 0) return send(res, 400, { error: t(lang, 'noBundle') })
  const name = query.get('name') ?? ''
  if (!pictureName(name)) return send(res, 400, { error: t(lang, 'pictureNameInvalid') })
  const replace = query.get('replace')
  if (replace !== null && replace !== '1') return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  const type = imageType(name)
  if ((req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() !== type)
    return send(res, 415, { error: t(lang, 'pictureTypeMismatch') })

  let bytes: Buffer
  try {
    bytes = await readBytes(req, lang, PICTURE_BYTES, 30_000)
  } catch (error) {
    return send(res, 413, { error: error instanceof Error ? error.message : t(lang, 'requestBodyTooLarge') })
  }
  // its text and colour profile, which sharp unpacks whatever the body's size (review 2026-11-06)
  if (!pngUnpacksWithin(bytes, PICTURE_UNPACKED)) return send(res, 415, { error: t(lang, 'pictureUnpacksTooFar') })
  // what sharp reads it as, by its bytes: the kind its name says, or it is refused
  const meta = await sharp(bytes)
    .metadata()
    .catch(() => undefined)
  if (meta?.format !== (type === 'image/png' ? 'png' : 'jpeg'))
    return send(res, 415, { error: t(lang, 'notThisPicture') })
  // read whole, as the build reads it: one cut short or broken inside fails here, not when the page is built
  const whole = await sharp(bytes)
    .timeout({ seconds: IMAGE_SECONDS })
    .resize(64, 64, { fit: 'inside' })
    .toBuffer()
    .then(
      () => true,
      () => false,
    )
  if (!whole) return send(res, 415, { error: t(lang, 'pictureBroken') })

  const taken = await takenName(dirs, name)
  if (taken && (replace === null || taken.name !== name))
    return send(res, 409, { error: t(lang, 'pictureExists'), exists: taken.name })
  if (taken && !taken.plain) return send(res, 409, { error: t(lang, 'pictureNotPlain'), exists: taken.name })
  // a new one in the bundle's own folder, shared by its languages
  const target = taken?.path ?? join(dirs.at(-1)!, name)
  // written whole beside it first, under a hidden name the list leaves out, so that the build never reads half of it
  const temp = join(dirname(target), `.hadley-upload-${randomBytes(8).toString('hex')}`)
  // the temporary file is the editor's whatever it holds, the picture until someone else changes it (wroteItself)
  ownWrites.set(temp, OURS)
  ownWrites.set(target, OURS)
  try {
    await writeFile(temp, bytes, { flag: 'wx' })
    if (taken) await rename(temp, target)
    else await addOnce(temp, target)
  } catch (error) {
    ownWrites.delete(target)
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return send(res, 409, { error: t(lang, 'pictureExists'), exists: name })
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  } finally {
    await unlink(temp).catch(() => undefined)
  }
  ownWrites.set(target, identity(target))
  send(res, 200, { name, located: located(meta) })
}

// The files the editor wrote, each as it left it: the dev server does not rebuild for them, since its reload would
// close the field with what is not saved yet; the page shows a picture once its text is saved, which rebuilds it. A
// change of such a file by anyone else rebuilds as any change does (review 2026-11-06: a time window took the
// author's for the editor's).
const ownWrites = new Map<string, string>()
// a file still being written, or a temporary one, which is the editor's whatever it holds
const OURS = 'ours'

/** A file as it stands: its size, its modification and change times and its inode, or that it is gone. */
const identity = (path: string): string => {
  try {
    const { size, mtimeMs, ctimeMs, ino } = statSync(path)
    return `${size} ${mtimeMs} ${ctimeMs} ${ino}`
  } catch {
    return 'gone'
  }
}

/** A file the editor took away (trash.ts): its going rebuilds nothing, as a picture it added (wroteItself). */
export const tookAway = (path: string): void => void ownWrites.set(path, 'gone')

/** Whether the file at `path` is as the editor left it (handleUpload): a change of its own, not someone else's. */
export function wroteItself(path: string): boolean {
  const own = ownWrites.get(path)
  if (own === undefined) return false
  if (own === OURS || identity(path) === own) return true
  ownWrites.delete(path)
  return false
}

/**
 * Puts `temp` in place under `target` unless a file is there by then, never showing half of it: a hard link, else
 * (a file system without them) the name claimed by an empty file, exclusively, and the whole file renamed onto it.
 */
export async function addOnce(temp: string, target: string, linkFile = link): Promise<void> {
  try {
    await linkFile(temp, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error
    await writeFile(target, '', { flag: 'wx' })
    await rename(temp, target)
  }
}
