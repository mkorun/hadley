/**
 * The files of a page's bundle, which the editor offers to put in (browser/features/files.ts): listed as the build
 * finds them, and an image of them served to the editor.
 */
import type { ServerResponse } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPageName } from '../../lib/bundles.ts'
import { isSystemFile } from '../../lib/platform.ts'
import { lookupDirs } from '../../lib/site-paths.ts'
import { blockIdMap } from './blocks.ts'
import { send } from './http.ts'
import { t, type Lang } from './i18n.ts'

const IMAGE_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
// its own keys only: `constructor` is no image (review 2026-11-05)
export const imageType = (name: string): string | undefined =>
  Object.hasOwn(IMAGE_TYPES, extension(name)) ? IMAGE_TYPES[extension(name)] : undefined

/**
 * The files of a page's bundle, each by the name its content gives it and where it lies, as the build finds them
 * (lookupDirs): beside its Markdown, then, for a page in a language directory, in the bundle above. Plain files only
 * (no link, no Markdown, nothing hidden or private, no other bundle's folder and no other language's), at most two
 * folders deep and 200 of them. A page that is one `.md` file has no bundle, and so none.
 */
export async function bundleFiles(filePath: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  // a name a link or another entry that is no plain file takes: the build takes it there, so the list offers it nowhere
  const shadowed = new Set<string>()
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.size >= 200) return
      const name = entry.name
      const path = join(dir, name)
      if (name.startsWith('.') || name.startsWith('_') || isSystemFile(name)) continue
      if (entry.isDirectory()) {
        // a folder in brackets is a bundle of its own, one with a page a language's
        if (depth < 2 && !name.startsWith('[') && !(await holdsPage(path)))
          await walk(path, `${prefix}${name}/`, depth + 1)
      } else if (files.has(prefix + name) || shadowed.has(prefix + name)) continue
      else if (entry.isFile() && extension(name) !== 'md') files.set(prefix + name, path)
      else shadowed.add(prefix + name)
    }
  }
  for (const dir of lookupDirs(filePath)) await walk(dir, '', 0)
  return files
}

const holdsPage = async (dir: string): Promise<boolean> => {
  try {
    return (await readdir(dir, { withFileTypes: true })).some((entry) => entry.isFile() && isPageName(entry.name))
  } catch {
    return false
  }
}

/** The names of a page's bundle files, in their order (bundleFiles). */
export const bundleFileNames = async (filePath: string): Promise<string[]> => [...(await bundleFiles(filePath)).keys()]

/** The list of a block's bundle files, or one of its images, which a name may only take from that list. */
export async function serveBundleFile(res: ServerResponse, url: string, lang: Lang): Promise<void> {
  const [blockId = '', ...rest] = url.slice('/__hadley/files/'.length).split('?')[0]!.split('/')
  const entry = blockIdMap.get(blockId)
  if (!entry) return send(res, 404, { error: t(lang, 'blockNotFound') })
  const files = await bundleFiles(entry.filePath)
  if (rest.length === 0) {
    // whether the page's Markdown names it, so that taking it away warns (trash.ts)
    const text = await readFile(entry.filePath, 'utf-8').catch(() => '')
    const listed = [...files.keys()].map((name) => ({
      name,
      image: imageType(name) !== undefined,
      used: text.includes(`(${name})`) || text.includes(`(${name} `),
    }))
    return send(res, 200, { files: listed })
  }
  let name: string
  try {
    name = decodeURIComponent(rest.join('/'))
  } catch {
    return send(res, 400, { error: t(lang, 'assetNotFound') })
  }
  const type = imageType(name)
  const path = files.get(name)
  if (!type || !path) return send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${name}` })
  try {
    const content = await readFile(path)
    res.statusCode = 200
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-store')
    // an SVG shown as an image runs no script; opened on its own, this keeps it from running any
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(content)
  } catch {
    send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${name}` })
  }
}
