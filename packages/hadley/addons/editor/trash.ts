/**
 * A file of a page's bundle the editor takes away (browser/features/files.ts; Michael, 2026-11-09): not deleted, but
 * moved to the site's `.hadley/trash/<time>/`, under its path in the site, from where it can be brought back by hand;
 * the history keeps a page's Markdown only. Only a file the list of that block's bundle names (bundleFiles), a plain
 * file, never through a link, and never one outside the site. Its going rebuilds nothing (tookAway): a reload would
 * close the open field.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { constants, copyFile, lstat, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { siteRoot } from './history.ts'
import { t, type Lang } from './i18n.ts'
import { blockIdMap } from './blocks.ts'
import { bundleFiles } from './bundle.ts'
import { readBody, send } from './http.ts'
import { tookAway } from './upload.ts'

/** `YYYY-MM-DD-HHMMSS`, in the author's own time: the trash's folders sort as they came. */
function stamp(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '')
}

export async function handleTrash(req: IncomingMessage, res: ServerResponse, lang: Lang): Promise<void> {
  let body: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readBody(req, lang))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    body = parsed as Record<string, unknown>
  } catch {
    return send(res, 400, { error: t(lang, 'invalidRequestBody') })
  }
  const entry = typeof body['block'] === 'string' ? blockIdMap.get(body['block']) : undefined
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  const name = body['name']
  const path = typeof name === 'string' ? (await bundleFiles(entry.filePath)).get(name) : undefined
  if (!path) return send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${String(name)}` })
  const root = siteRoot()
  const inSite = root === undefined ? '' : relative(root, path)
  if (!root || !inSite || inSite.startsWith('..') || isAbsolute(inSite))
    return send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${String(name)}` })
  const stat = await lstat(path).catch(() => undefined)
  if (!stat?.isFile()) return send(res, 409, { error: t(lang, 'pictureNotPlain') })

  // a folder of its own where the second's already holds a file of that path: nothing in the trash is overwritten
  // (review 2026-11-09: the same file taken away twice in a second kept only the second); one trash at a time
  // (oneAtATime), so the free place found stays free
  const second = stamp()
  let target = ''
  for (let n = 1; n <= 100 && !target; n++) {
    const place = join(root, '.hadley', 'trash', n === 1 ? second : `${second}-${n}`, inSite)
    if (!(await lstat(place).catch(() => undefined))) target = place
  }
  if (!target) return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  tookAway(path)
  try {
    await mkdir(dirname(target), { recursive: true })
    await rename(path, target).catch(async (error: NodeJS.ErrnoException) => {
      // another file system: copied, then taken away
      if (error.code !== 'EXDEV') throw error
      await copyFile(path, target, constants.COPYFILE_EXCL)
      await unlink(path)
    })
  } catch {
    return send(res, 500, { error: t(lang, 'couldNotWriteFile') })
  }
  send(res, 200, { ok: true, trash: relative(root, target).replaceAll('\\', '/') })
}
