/**
 * The block editor's Vite plugin: the routes under /__hadley/, each handed to the module that answers it. The editor's
 * browser code (browser-files.ts), Lima's reader for the browser, the bundle's files (bundle.ts), a block read and
 * changed (edits.ts), a picture added (upload.ts) or a file taken away (trash.ts), the versions (history-routes.ts),
 * and whether the server runs older code than lies on the disk (lib/code-stamp.ts). Writes go one at a time.
 */
import type { Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeChanged } from '../../lib/code-stamp.ts'
import { pageHeads } from './blocks.ts'
import { browserFile } from './browser-files.ts'
import { serveBundleFile } from './bundle.ts'
import { handleDelete, handleGet, handleMerge, handleMove, handlePatch } from './edits.ts'
import { historyRoute } from './history-routes.ts'
import { getLang, send } from './http.ts'
import { t, type Lang } from './i18n.ts'
import { handleTrash } from './trash.ts'
import { handleUpload } from './upload.ts'

// Lima's own reader, for the browser: the editor shows the front matter's keys where outline() finds them
const limaDir = dirname(fileURLToPath(import.meta.resolve('@limaformat/lima')))
const LIMA_MODULE = /^\/__hadley\/lima\/([a-z0-9-]+\.js)$/

/** The editor's browser code (browser-files.ts). */
async function serveBrowserFile(res: ServerResponse, path: string, lang: Lang): Promise<void> {
  const file = await browserFile(path)
  if (!file) return send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${path}` })
  res.statusCode = 200
  res.setHeader('Content-Type', file.type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(file.body)
}

/** A module of @limaformat/lima's dist, by its plain name only: no path, no other file. */
async function serveLima(res: ServerResponse, filename: string, lang: Lang): Promise<void> {
  try {
    const content = await readFile(join(limaDir, filename), 'utf-8')
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(content)
  } catch {
    send(res, 404, { error: `${t(lang, 'assetNotFound')}: ${filename}` })
  }
}

// The editor's writes one after another: each reads its file, checks the hash and writes before the next reads, so two
// changes at once cannot both pass the check and the second write over the first (review 2026-10-29)
let writing: Promise<unknown> = Promise.resolve()
export function oneAtATime(write: () => Promise<void>): Promise<void> {
  const run = writing.then(write)
  writing = run.catch(() => undefined)
  return run
}

// said once in the terminal, whatever the pages ask
let toldStale = false

export function blockEditorPlugin(): Plugin {
  return {
    name: 'hadley-block-editor',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__hadley/')) return next()

        const method = req.method ?? 'GET'
        const lang = getLang(req)

        let handler: Promise<void> | null = null

        if (method === 'GET' && url.startsWith('/__hadley/editor/')) {
          handler = serveBrowserFile(res, url.split('?')[0]!, lang)
        } else if (method === 'GET' && url.startsWith('/__hadley/files/')) {
          handler = serveBundleFile(res, url, lang)
        } else if (method === 'GET' && LIMA_MODULE.test(url)) {
          handler = serveLima(res, LIMA_MODULE.exec(url)?.[1] ?? '', lang)
        } else if (method === 'GET' && url.split('?')[0] === '/__hadley/heads') {
          // the blocks that edit the page's title and subtitle, which the editor opens where the theme marks them
          const path = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
          const heads = pageHeads.get(path)
          handler = Promise.resolve(
            send(res, 200, {
              ...(heads?.title ? { title: heads.title } : {}),
              ...(heads?.subtitle ? { subtitle: heads.subtitle } : {}),
              ...(heads?.frontMatter ? { frontMatter: heads.frontMatter } : {}),
              ...(heads?.undescribed ? { undescribed: true } : {}),
            }),
          )
        } else if (method === 'GET' && url.startsWith('/__hadley/block/')) {
          handler = handleGet(req, res)
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/patch') {
          handler = oneAtATime(() => handlePatch(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/delete') {
          handler = oneAtATime(() => handleDelete(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/move') {
          handler = oneAtATime(() => handleMove(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/merge') {
          handler = oneAtATime(() => handleMerge(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/upload') {
          handler = oneAtATime(() => handleUpload(req, res))
        } else if (method === 'POST' && url.split('?')[0] === '/__hadley/trash') {
          // a file of a page's bundle taken away, into the site's .hadley/trash/ (trash.ts)
          handler = oneAtATime(() => handleTrash(req, res, lang))
        } else if (method === 'GET' && url.split('?')[0] === '/__hadley/stale') {
          // hadley's own code changed since the start: the editor asks the author to restart (lib/code-stamp.ts)
          handler = codeChanged().then((stale) => {
            if (stale && !toldStale) {
              toldStale = true
              console.warn("[dev]   hadley's own code changed since the dev server started: restart it (Ctrl+C)")
            }
            send(res, 200, { stale })
          })
        } else if (url.startsWith('/__hadley/history')) {
          // the time machine (history-routes.ts)
          handler = historyRoute(req, res, lang).then((answered) => {
            if (!answered) send(res, 404, { error: t(lang, 'notFound') })
          })
        }

        if (handler) {
          handler.catch((err) => {
            if (!res.headersSent) send(res, 500, { error: String(err) })
          })
        } else {
          send(res, 404, { error: t(lang, 'notFound') })
        }
      })
    },
  }
}
