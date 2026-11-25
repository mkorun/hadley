// `hadley comments` and `hadley dev comments`: moderating a site's comments in the terminal (docs/comments.md). The
// session (session.ts) keeps the decisions, the screen (screen.ts) shows a comment, messages.ts holds the texts.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pageFiles, type PageFile } from '../../lib/bundles.ts'
import { formsDataDir } from '../../lib/forms-service.ts'
import { lf, readableByOthers } from '../../lib/platform.ts'
import {
  checkConfig,
  commentsServiceUrl,
  defaultLanguageOf,
  readConfig,
  readMetaFiles,
  templateOptions,
} from '../../lib/site-config.ts'
import { userConfigDir } from '../../lib/user-config.ts'
import { generateEml } from './eml.ts'
import { messagesFor, type Messages } from './messages.ts'
import { renderComments } from './render.ts'
import { screen, type QueueEntry } from './screen.ts'
import { openSession, type Session } from './session.ts'

const SERVICE_TIMEOUT_MS = 30_000
const EDITOR_TIMEOUT_MS = 2 * 60 * 60 * 1000 // an editor the owner works in
// the terminal's alternate screen, where the moderation runs, like less or an editor
const ALTERNATE_SCREEN = '\x1b[?1049h'
const MAIN_SCREEN = '\x1b[?1049l'

/** Whether the admin token may go to `url`: over https, or to this machine. */
export const carriesToken = (url: string): boolean => {
  if (!URL.canParse(url)) return false
  const { protocol, hostname } = new URL(url)
  return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

/** The pages under content/articles/ and content/essays/, as the build finds them (lib/bundles.ts). */
async function articleFiles(siteDir: string, defaultLanguage: string): Promise<PageFile[]> {
  const files: PageFile[] = []
  for (const root of ['articles', 'essays'])
    files.push(...(await pageFiles(join(siteDir, 'content'), root, defaultLanguage)))
  return files
}

/**
 * The directory an article's comments belong in: its bundle under content/articles/ or content/essays/, and for
 * another language that language's folder in it; undefined for an id no article or essay bundle has, and nothing is
 * created.
 */
export async function articleDirs(
  siteDir: string,
  defaultLanguage: string,
): Promise<(articleId: string, lang: string) => string | undefined> {
  const bundles = new Map<string, string>()
  for (const file of await articleFiles(siteDir, defaultLanguage)) bundles.set(file.bundleId, file.bundleDir)
  return (articleId, lang) => {
    const bundle = bundles.get(articleId)
    // as the service checks it (services/forms/CONTRACT.md): the name of one folder, whatever the queue says
    if (!/^[a-z]{2}(-[a-z0-9_-]+)?$/i.test(lang)) return undefined
    return bundle && (lang === defaultLanguage ? bundle : join(bundle, lang))
  }
}

/** An article in one language whose directory holds a comments.json. */
interface CommentedArticle {
  articleId: string
  language: string
  dir: string // where its comments.json lies and the build reads its _comments.html (lib/write-pages.ts)
}

/** Every article that has a comments.json, in each of its languages that has one. */
async function commentedArticles(siteDir: string, defaultLanguage: string): Promise<CommentedArticle[]> {
  const found = new Map<string, CommentedArticle>() // by directory: an article's variants share it
  for (const file of await articleFiles(siteDir, defaultLanguage)) {
    const dir = dirname(file.file)
    if (existsSync(join(dir, 'comments.json')))
      found.set(dir, { articleId: file.bundleId, language: file.language, dir })
  }
  return [...found.values()]
}

/**
 * The admin token (docs/comments.md): HADLEY_COMMENTS_TOKEN; else for the local service the one it made in its data
 * directory, for production the file `<user configuration>/comments/<host>.token`, which only its owner may read.
 */
export async function adminTokenFor(
  siteDir: string,
  dev: boolean,
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (env.HADLEY_COMMENTS_TOKEN) return env.HADLEY_COMMENTS_TOKEN
  if (dev) {
    const path = join(formsDataDir(siteDir), 'dev-secrets.json')
    const text = await readFile(path, 'utf-8').catch(() => {
      throw new Error(`${path} is missing: start hadley dev first, its comments service makes it`)
    })
    const token = (JSON.parse(text) as { adminToken?: unknown }).adminToken
    if (typeof token !== 'string' || !token) throw new Error(`${path}: no adminToken`)
    return token
  }
  const path = join(userConfigDir(env), 'comments', `${host}.token`)
  const info = await stat(path).catch(() => {
    throw new Error(`no admin token for ${host}: set HADLEY_COMMENTS_TOKEN, or put it in ${path} (mode 600)`)
  })
  if (readableByOthers(info.mode))
    throw new Error(`${path} can be read by others (${(info.mode & 0o777).toString(8)}): chmod 600 it`)
  const token = (await readFile(path, 'utf-8')).trim()
  if (!token) throw new Error(`${path} is empty`)
  return token
}

/**
 * The moderation archive: for the local service in its data directory, apart from production; else `comments.archive`
 * of config.lima, relative to the site's directory, which `hadley comments` needs.
 */
export function archiveDirFor(siteDir: string, archive: unknown, dev: boolean): string {
  if (dev) return join(formsDataDir(siteDir), 'archive')
  if (typeof archive !== 'string' || !archive)
    throw new Error(
      'config.lima: comments.archive is missing: the directory, relative to the site, where hadley comments keeps ' +
        "its decisions with the visitors' email addresses (for example ../private/comments)",
    )
  return resolve(siteDir, archive)
}

// siteDir: the site's directory (lib/site-root.ts)
export async function runCommentsCli(
  siteDir: string,
  // dev: the comments service a dev server started, at devServiceUrl
  opts: { dev: false } | { dev: true; devServiceUrl: string },
): Promise<void> {
  const config = checkConfig(await readConfig(siteDir, await readMetaFiles(siteDir)))
  const galleyOptions = templateOptions(config)
  const serviceUrl = opts.dev ? opts.devServiceUrl : commentsServiceUrl(config)
  if (!carriesToken(serviceUrl))
    throw new Error(`the comments service at ${serviceUrl} is neither https nor this machine: no admin token for it`)
  const origin = config.site?.origin
  if (typeof origin !== 'string' || !URL.canParse(origin)) throw new Error('config.lima: site.origin is no URL')
  const host = new URL(origin).host
  const defaultLanguage = defaultLanguageOf(config)
  const authorName: string = config.comments?.authorName ?? config.site?.default?.title ?? host
  const m = messagesFor(defaultLanguage)

  const adminToken = await adminTokenFor(siteDir, opts.dev, host)
  const archiveDir = archiveDirFor(siteDir, config.comments?.archive, opts.dev)
  const workDir = join(siteDir, '.hadley', 'comments')
  const mailDir = join(siteDir, '.hadley', 'mail')
  await mkdir(workDir, { recursive: true })
  await mkdir(archiveDir, { recursive: true, mode: 0o700 })
  await mkdir(mailDir, { recursive: true })

  // the titles of the dev build's sitelinks.json, where there is one; else the screen shows an article's id
  const titles = new Map<string, string>() // "id::lang" → title
  try {
    const sitelinks = JSON.parse(await readFile(join(siteDir, '.hadley', 'dev', 'sitelinks.json'), 'utf-8'))
    for (const page of sitelinks.pages ?? []) titles.set(`${page.id}::${page.lang}`, page.title)
  } catch {}
  const titleOf = (id: string, lang: string) => titles.get(`${id}::${lang}`) ?? titles.get(`${id}::${defaultLanguage}`)
  const articleDir = await articleDirs(siteDir, defaultLanguage)

  const service = (method: 'GET' | 'DELETE') =>
    fetch(`${serviceUrl}/admin/comments`, {
      method,
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    })
  const opened = await openSession(workDir, archiveDir, async () => {
    const response = await service('GET')
    if (!response.ok) throw new Error(`GET ${serviceUrl}/admin/comments: ${response.status} ${response.statusText}`)
    return (await response.json()) as { resumed: boolean; comments: QueueEntry[] }
  })
  if (opened.kind === 'resumed') console.log(m.resumedLocal(opened.file, (await opened.session.pending()).length))
  else if (opened.serverResumed) console.log(m.resumedServer)
  if (opened.kind === 'nothing') console.log(m.nothingNew)
  else {
    if (opened.kind === 'downloaded') console.log(m.downloaded(opened.session.total))
    await pause(1200)
    const { approved, rejected } = await moderate(opened.session, {
      m,
      host,
      language: defaultLanguage,
      authorName,
      titleOf,
      articleDir,
      mailDir,
    })
    if (approved + rejected > 0) console.log(m.decided(approved, rejected))
  }

  // Every _comments.html is written from its comments.json in every run, whatever this run approved: one that a run
  // before could not write is written by the next, with no record of it to keep.
  const articles = await commentedArticles(siteDir, defaultLanguage)
  if (articles.length > 0) console.log(m.rendering(articles.length))
  let failed = 0
  for (const { articleId, language, dir } of articles) {
    try {
      const html = await renderComments({
        siteDir,
        defaultLanguage,
        commentsJsonPath: join(dir, 'comments.json'),
        language,
        templateOptions: galleyOptions,
      })
      await writeFile(join(dir, '_comments.html'), html)
    } catch (error) {
      failed++
      console.error(m.renderFailed(articleId, language, error instanceof Error ? error.message : String(error)))
    }
  }

  // an approved comment is safe in its comments.json, so the service may delete it, written or not
  if (opened.kind !== 'nothing') {
    if (await opened.session.finish()) {
      console.log(m.deletingOnService)
      const response = await service('DELETE')
      console.log(response.ok ? m.deletedOnService : m.deleteFailed(response.status))
    } else {
      console.log(m.pending((await opened.session.pending()).length))
    }
  }
  if (failed > 0) throw new Error(m.notWritten(failed))
}

interface Moderation {
  m: Messages
  host: string
  language: string
  authorName: string
  titleOf: (id: string, lang: string) => string | undefined
  articleDir: (id: string, lang: string) => string | undefined
  mailDir: string
}

/**
 * Shows the comments one at a time, on the terminal's alternate screen, until all are decided or the owner quits;
 * returns how many comments were approved and rejected.
 */
async function moderate(session: Session, ctx: Moderation): Promise<{ approved: number; rejected: number }> {
  const { m } = ctx
  let approved = 0
  let rejected = 0
  const say = async (text: string, ms = 900) => {
    console.log(`\n ${text}`)
    await pause(ms)
  }
  process.stdin.setRawMode(true)
  process.stdin.resume()
  if (process.stdout.isTTY) process.stdout.write(ALTERNATE_SCREEN)
  try {
    for (;;) {
      const work = await session.pending()
      const entry = work[0]
      if (!entry) break
      const archived = await session.archived(entry.id)
      process.stdout.write('\x1b[2J\x1b[H')
      console.log(
        screen(
          {
            entry,
            position: session.total - work.length + 1,
            total: session.total,
            site: ctx.host,
            articleTitle: ctx.titleOf(entry.article_id, entry.language_version),
            note: archived?.moderator_remark ?? null,
            reply: archived?.author_reply_draft ?? null,
            mailWritten: archived?.mail_sent ?? false,
            language: ctx.language,
          },
          m,
          process.stdout.columns ?? 80,
          (process.stdout.isTTY ?? false) && !process.env.NO_COLOR,
        ),
      )
      const key = await waitKey()
      if (key === 'q' || key === '\x03') break
      if (key === 'a') {
        const dir = ctx.articleDir(entry.article_id, entry.language_version)
        if (!dir) {
          await say(m.noArticle(entry.article_id), 2000)
          continue
        }
        await session.approve(entry, join(dir, 'comments.json'), ctx.authorName)
        approved++
        await say(m.approved(entry.name), 500)
      } else if (key === 'r') {
        console.log(`\n ${m.confirmReject}`)
        if ((await waitKey()) === 'r') {
          await session.reject(entry.id)
          rejected++
          await say(m.rejected, 500)
        } else await say(m.cancelled)
      } else if (key === 'e' || key === 'n' || key === 'c') {
        const initial =
          key === 'e' ? entry.text : key === 'n' ? archived?.moderator_remark : archived?.author_reply_draft
        const text = openEditor(initial ?? '')
        if (!text) await say(m.cancelled)
        else if (key === 'e') await session.edit(entry.id, text)
        else if (key === 'n') {
          await session.note(entry.id, text)
          await say(m.noteSaved)
        } else {
          await session.draftReply(entry.id, text)
          await say(m.replySaved, 1500)
        }
      } else if (key === 'm' && entry.notify && !archived?.mail_sent) {
        const path = join(ctx.mailDir, `notify-${entry.id}.eml`)
        await writeFile(
          path,
          generateEml({
            to: entry.email,
            name: entry.name,
            language: entry.language_version,
            articleTitle: ctx.titleOf(entry.article_id, entry.language_version) ?? entry.article_id,
            commentText: entry.text,
            commentId: entry.id,
            authorName: ctx.authorName,
          }),
        )
        await session.mailWritten(entry.id)
        await say(m.mailSaved(path), 1500)
      }
    }
  } finally {
    if (process.stdout.isTTY) process.stdout.write(MAIN_SCREEN)
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  return { approved, rejected }
}

/**
 * The text the owner wrote in $EDITOR (else $VISUAL, else nano, on Windows Notepad), starting from `initial`; null
 * when left empty.
 */
function openEditor(initial: string): string | null {
  // a directory of the user's own: a name in the shared one could be taken before the file is written
  const dir = mkdtempSync(join(tmpdir(), 'hadley-comment-'))
  const file = join(dir, 'comment.txt')
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'nano')
  process.stdin.setRawMode(false)
  try {
    writeFileSync(file, initial, { mode: 0o600 })
    const result = spawnSync(editor, [file], { stdio: 'inherit', timeout: EDITOR_TIMEOUT_MS })
    if (result.status !== 0) return null
    return lf(readFileSync(file, 'utf-8')).trim() || null
  } finally {
    rmSync(dir, { recursive: true, force: true })
    process.stdin.setRawMode(true)
    // an editor that has a screen of its own leaves the main screen when it ends
    if (process.stdout.isTTY) process.stdout.write(ALTERNATE_SCREEN)
  }
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

function waitKey(): Promise<string> {
  return new Promise((done) => process.stdin.once('data', (chunk: Buffer) => done(chunk.toString())))
}
