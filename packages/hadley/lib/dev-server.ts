import { spawn } from 'node:child_process'
import { access, constants, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { realpathSync, watch } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import http from 'node:http'
import { createServer as createViteServer, createLogger } from 'vite'
import { parse as limaparse } from '@limaformat/lima'
import { build } from '../index.ts'
import { networkUrls, qrCode, wslNetworking } from './dev-addresses.ts'
import { commentsPort, localOrigin, portInUse, siteEditor, type DevOptions } from './dev-options.ts'
import { refusal } from './dev-guard.ts'
import { devCertificate } from './dev-https.ts'
import { clearScreen, logger } from './logger.ts'
import { changedSince, isSystemFile } from './platform.ts'
import { FORMS_PROGRAM, devServiceEnv, formsDataDir, formsProgram } from './forms-service.ts'
import { siteLabel } from './site-root.ts'
import { readUserConfig } from './user-config.ts'

// what the dev server hands to the comments service instead of serving it
const COMMENTS_PATHS = ['/api/comment/', '/admin/']
const VITE_STALL_MS = 15_000

/** The explicit UTF-8 type of text files Vite would otherwise infer incompletely. */
export const textContentType = (path: string): string | undefined =>
  path.endsWith('.md')
    ? 'text/markdown; charset=utf-8'
    : path.endsWith('.txt')
      ? 'text/plain; charset=utf-8'
      : undefined

export interface DevServerOptions {
  siteDir: string // the site's directory (lib/site-root.ts)
  outputMode: 'dev' | 'publish'
  serve: DevOptions // port, HTTPS (lib/dev-options.ts)
  noWatch?: boolean
  noBuild?: boolean
}

/**
 * Serves the output directory of a site with Vite, on localhost (docs/dev-server.md): over HTTP, or over HTTPS with
 * the certificate of lib/dev-https.ts. With comments enabled and hadley-forms found (lib/forms-service.ts), it starts
 * that service on the next port and proxies its paths to it. Unless `noWatch`, it rebuilds on every change.
 */
export async function startDevServer({
  siteDir,
  outputMode,
  serve,
  noWatch = false,
  noBuild = false,
}: DevServerOptions): Promise<void> {
  const outputDir = `.hadley/${outputMode}`
  const siteTmp = join(siteDir, outputDir)

  let shuttingDown = false

  const isTTY = process.stdout.isTTY ?? false
  const dim = isTTY ? '\x1b[2m' : ''
  const reset = isTTY ? '\x1b[0m' : ''

  const devLog = (msg: string) => console.log(`${dim}[dev]${reset}   ${msg}`)
  const devWarn = (msg: string) => console.warn(`${dim}[dev]${reset}   ${msg}`)
  const devErr = (msg: string) => console.error(`${dim}[dev]${reset}   ${msg}`)

  // Create output dir if it doesn't exist
  try {
    await access(siteTmp, constants.F_OK)
  } catch {
    await mkdir(siteTmp, { recursive: true })
  }

  const hasKeyboard = process.stdin.isTTY === true
  devLog(hasKeyboard ? 'r = rebuild · q = quit' : '(no keyboard: not a terminal)')

  const userConfig = await readUserConfig()
  const origin = localOrigin(serve)
  // the names it answers to besides localhost and addresses, which Vite checks over HTTP only (lib/dev-guard.ts)
  const allowedHosts = [...(userConfig.dev.hostname ? [userConfig.dev.hostname] : []), ...userConfig.dev.allowedHosts]
  // where other devices reach it, with --host: under WSL in NAT mode at no address of Linux
  const wsl = serve.host ? wslNetworking() : undefined
  const network = serve.host ? networkUrls(serve, userConfig.dev.hostname, wsl === 'nat' ? {} : undefined) : []
  const https = serve.https ? await devCertificate(userConfig) : undefined

  // Load site config (addon enabled flags + CORS origins)
  const configRaw = await readFile(join(siteDir, 'config.lima'), 'utf-8').catch(() => '')
  const siteConfig = configRaw ? (limaparse(configRaw) as any) : null

  // the comments service, when config.lima enables comments and there is one (lib/forms-service.ts)
  const commentsEnabled = siteConfig?.comments?.enabled === true
  const forms = commentsEnabled ? formsProgram(userConfig.dev.forms) : undefined
  if (commentsEnabled && !forms)
    devWarn(`comments.enabled is true, but ${FORMS_PROGRAM} is not on the PATH: comments are off (docs/dev-server.md)`)
  const hasComments = forms !== undefined
  // the block editor, loaded only when config.lima turns it on, and only for `hadley dev`
  const editor = outputMode === 'dev' && siteEditor(siteConfig) ? await import('../addons/editor/index.ts') : undefined
  const servicePort = commentsPort(serve.port)
  // a port taken stops before anything starts: Vite would only stop later, and a comments service could be another's
  const ports: [number, string][] = [[serve.port, 'the dev server']]
  if (hasComments) ports.push([servicePort, 'its comments service'])
  for (const [port, what] of ports) {
    if (await portInUse(port)) {
      devErr(`Port ${port} for ${what} is in use, perhaps by another hadley dev: pass --port <n>, or set dev.port`)
      process.exit(1)
    }
  }
  let commentsProcess: ReturnType<typeof spawn> | null = null

  if (forms) {
    commentsProcess = spawn(forms, ['-dev'], {
      cwd: siteDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...devServiceEnv(process.env),
        DATA_DIR: formsDataDir(siteDir),
        PORT: String(servicePort),
        ...(siteConfig?.site?.origin ? { SITE_ORIGINS: siteConfig.site.origin } : {}),
        DEV_ORIGIN: [origin, ...network].join(','),
      },
    })
    const prefix = (line: string) => console.log(`${dim}[forms]${reset} ${line.trimEnd()}`)
    commentsProcess.stdout?.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach(prefix))
    commentsProcess.stderr?.on('data', (d: Buffer) =>
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((l) => console.error(`${dim}[forms]${reset} ${l.trimEnd()}`)),
    )
    commentsProcess.on('exit', (code) => {
      if (!shuttingDown) devWarn(`⚠ Comment service exited unexpectedly (code ${code})`)
    })

    // Wait for the comment service to be ready before proceeding
    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      let done = false

      commentsProcess!.on('exit', (code) => {
        if (!done) {
          done = true
          reject(new Error(`Comment service exited early (code ${code})`))
        }
      })

      const tryConnect = () => {
        if (shuttingDown) return reject(new Error('Shutdown in progress'))
        if (attempts++ >= 30) return reject(new Error('Comment service did not respond in time'))
        const req = http.get({ host: '127.0.0.1', port: servicePort, path: '/api/comment/token' }, (res) => {
          res.destroy()
          if (!done) {
            done = true
            resolve()
          }
        })
        req.on('error', () => {
          if (!shuttingDown) setTimeout(tryConnect, 300)
        })
      }
      tryConnect()
    }).catch((error) => {
      // one that does not answer would keep its port from the next start
      commentsProcess?.kill()
      throw error
    })
    devLog(`Comment service ready (port ${servicePort})`)
  }

  // Step 2: Start Vite
  devLog(`Starting Vite for ${siteLabel(siteDir, siteConfig)}...`)
  // Suppress Vite's dynamic-import-vars warning from pagefind-ui.js —
  // Pagefind uses a runtime-variable path intentionally, not analysable by Vite.
  const viteLogger = createLogger()
  const _warnOrig = viteLogger.warn.bind(viteLogger)
  viteLogger.warn = (msg, opts) => {
    if (msg.includes('pagefind') && msg.includes('dynamic import cannot be analyzed')) return
    _warnOrig(msg, opts)
  }

  // Vite starts in well under a second; a start that hangs would otherwise say nothing at all
  let starting = 'creating its server'
  const stalled = setTimeout(
    () =>
      devErr(`Vite has not started after ${VITE_STALL_MS / 1000} s, at: ${starting}; stop and start hadley dev again`),
    VITE_STALL_MS,
  )
  // by its long name: under a Windows short name (C:\Users\RUNNER~1) Vite refuses the files as outside its root
  const served = realpathSync.native(siteTmp)
  const vite = await createViteServer({
    configFile: false,
    root: served,
    // a site of pages, not one page for every path: a file that is not there is a 404, not the home page
    appType: 'mpa',
    customLogger: viteLogger,
    // Static site: no JS modules to discover or pre-bundle.
    // noDiscovery: true prevents Vite from crawling HTML on hard-reload (eliminates ~4s block).
    // entries: [] + noDiscovery: true = dep optimizer completely inert.
    optimizeDeps: { entries: [], noDiscovery: true },
    server: {
      port: serve.port,
      // every interface with --host; a name other devices use must be allowed (Vite allows addresses itself)
      host: serve.host ? true : 'localhost',
      // the port asked for, or none: another would not be the origin the comments service allows
      strictPort: true,
      ...(https ? { https } : {}),
      ...(hasComments
        ? {
            proxy: Object.fromEntries(
              COMMENTS_PATHS.map((path) => [path, { target: `http://127.0.0.1:${servicePort}` }]),
            ),
          }
        : {}),
      hmr: true,
      // watch: null — we handle all rebuilds + full-reloads ourselves (vite.ws.send).
      // Vite's chokidar watcher is only needed for incremental HMR (React/Vue components),
      // which we never use. Enabling it (especially usePolling) adds overhead for nothing.
      watch: null,
      open: false,
      allowedHosts,
      // no file but those of the output directory (as Vite compares them, with links resolved), also not by /@fs/
      fs: { strict: true, allow: [served] },
    },
    plugins: [
      // first, before the editor and the proxy see a request (lib/dev-guard.ts)
      {
        name: 'hadley-guard',
        configureServer(server) {
          const allowed = { origin, hosts: allowedHosts }
          server.middlewares.use((req, res, next) => {
            const refused = refusal(req, req.socket.remoteAddress, allowed)
            if (!refused) return next()
            res.statusCode = refused.status
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(`refused: ${refused.reason}\n`)
          })
        },
      },
      ...(editor ? [editor.blockEditorPlugin()] : []),
      {
        name: 'hadley-static',
        configureServer(server) {
          // Serve HTML directly — bypasses Vite's transformIndexHtml pipeline which blocks
          // responses for several seconds while scanning for JS modules (none exist here).
          // We inject /@vite/client manually for HMR WebSocket (full-reload only).
          const serveHtml = async (res: any, filePath: string, status: number) => {
            const html = await readFile(filePath, 'utf-8')
            const editorInject = editor
              ? '<link rel="stylesheet" href="/__hadley/editor.css">' +
                '<script type="module" src="/__hadley/editor.js"></script>'
              : ''
            const injected = html.replace(
              '</head>',
              editorInject + '<script type="module" src="/@vite/client"></script>' + '</head>',
            )
            res.statusCode = status
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(injected)
          }
          const serveSitePage = async (url: string, res: http.ServerResponse, next: (err?: unknown) => void) => {
            // text files as UTF-8, which Vite does not say; only one of the output directory
            const textPath = url.split('?')[0]!
            const contentType = textContentType(textPath)
            if (contentType) {
              const txtPath = join(siteTmp, decodeURIComponent(url.split('?')[0]!))
              if (!resolve(txtPath).startsWith(resolve(siteTmp) + sep)) return next()
              const text = await readFile(txtPath, 'utf-8').catch(() => undefined)
              if (text === undefined) return next()
              res.setHeader('Content-Type', contentType)
              res.end(text)
              return
            }
            // Pass through: Vite internals, the comments service, assets (contain .), query strings
            const toService = hasComments && COMMENTS_PATHS.some((path) => url.startsWith(path))
            if (url.startsWith('/@') || toService || url.includes('.') || url.includes('?')) {
              return next()
            }
            // /autor/ → autor/index.html, / → index.html; decoded, and inside the output directory (lib/dev-guard.ts
            // refused . and .. segments before)
            const normalized = decodeURIComponent(url).replace(/^\//, '').replace(/\/$/, '')
            const filePath = join(siteTmp, normalized, 'index.html')
            if (!resolve(filePath).startsWith(resolve(siteTmp) + sep)) return next()
            try {
              await access(filePath, constants.F_OK)
              await serveHtml(res, filePath, 200)
            } catch {
              // the 404 page of the language the path begins with, else the default language's, as deploy.md has
              // a server answer; then 404.html, which a build under maintenance makes of its 503 page
              const language = normalized.split('/')[0]
              const pages = ['errors/404/index.html', '404.html'].flatMap((page) =>
                language ? [`${language}/${page}`, page] : [page],
              )
              for (const page of pages) {
                try {
                  return await serveHtml(res, join(siteTmp, page), 404)
                } catch {
                  // not there: the next one
                }
              }
              res.statusCode = 404
              res.end('404 Not Found')
            }
          }
          // Connect does not await a middleware: a failure goes to next(err), not to an unhandled rejection.
          server.middlewares.use((req, res, next) => {
            serveSitePage(req.url ?? '/', res, next).catch(next)
          })
        },
      },
    ],
  })
  starting = `listening on ${serve.host ? 'every interface' : 'localhost'}`
  await vite.listen()
  clearTimeout(stalled)

  devLog(`Ready at ${origin}`)
  for (const url of network) devLog(`        ${url}`)
  if (wsl === 'nat')
    devWarn('WSL runs in NAT mode: other devices reach none of its addresses; see docs/dev-server.md (mirrored mode)')
  else if (wsl === 'unknown')
    devWarn('WSL: could not tell its networking mode; in NAT mode other devices reach none of these addresses')
  if (network[0]) {
    const qr = await qrCode(network[0])
    if (qr) console.log(qr)
    else devLog('(a QR code of the first address needs the package uqr)')
  }
  // the browser, by the program the user configuration names (dev.open), with the URL last
  const open = userConfig.dev.open
  if (open) {
    // a browser it starts may stay as long as the user likes: nothing waits for it, and it outlives hadley
    const opener = spawn(open[0]!, [...open.slice(1), origin], { stdio: 'ignore', detached: true, windowsHide: true })
    opener.on('error', (error) => devWarn(`dev.open: ${error.message}`))
    opener.unref()
  }

  // Step 3: File watcher + rebuild
  let buildTimer: ReturnType<typeof setTimeout> | null = null
  let buildRunning = false
  let buildStarted = 0
  let buildQueued = false
  let lastBuildOk = false

  function triggerBuild(reason: string) {
    if (shuttingDown) return
    if (buildTimer) clearTimeout(buildTimer)
    buildTimer = setTimeout(() => void runBuild(reason), 150)
  }

  // Reports its own failures, so callers start it without awaiting.
  async function runBuild(reason = 'file change') {
    if (shuttingDown) return
    if (buildRunning) {
      buildQueued = true
      return
    }
    buildRunning = true
    buildStarted = Date.now()
    if (lastBuildOk) clearScreen()
    devLog(`Rebuilding (${reason})...`)
    try {
      const built = await build(siteDir, outputMode, {
        ...(editor
          ? { blockEditorHook: (blocks, filePath, rawDoc) => editor.registerPageBlocks(blocks, rawDoc, filePath) }
          : {}),
        deferSearch: true,
      })
      lastBuildOk = true
      if (!shuttingDown) {
        vite.moduleGraph.invalidateAll()
        vite.ws.send({ type: 'full-reload' })
      }
      // the page shows first; the next build waits for the search index (buildRunning)
      await built.search?.()
    } catch (err) {
      lastBuildOk = false
      logger.failed(err, siteDir)
    } finally {
      buildRunning = false
      if (!shuttingDown) devLog(hasKeyboard ? 'r = rebuild · q = quit' : '(no keyboard: not a terminal)')
      if (buildQueued && !shuttingDown) {
        buildQueued = false
        void runBuild('queued file change')
      }
    }
  }

  const watchers: ReturnType<typeof watch>[] = []
  if (!noWatch) {
    const watchDirs = [`${siteDir}/content`, `${siteDir}/theme`]

    // config.lima lies in the site's root: a watcher of its own, not recursive
    const configWatcher = watch(siteDir, (_event, filename) => {
      if (filename === 'config.lima') {
        devLog('config.lima')
        triggerBuild('config.lima')
      }
    })
    watchers.push(configWatcher)
    // inotify doesn't follow symlinks — resolve any symlinked subdirs in content/
    try {
      const contentEntries = await readdir(`${siteDir}/content`, { withFileTypes: true })
      for (const entry of contentEntries) {
        if (entry.isSymbolicLink()) {
          watchDirs.push(await realpath(`${siteDir}/content/${entry.name}`))
        }
      }
    } catch {}
    for (const dir of watchDirs) {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) {
          triggerBuild(dir)
          return
        }
        // comments.json is written per-approval during TUI — the build only reads
        // _comments.html, so skip these intermediate writes to avoid spurious rebuilds.
        if (filename.endsWith('comments.json') || isSystemFile(basename(filename))) return
        // on Windows a file the build only read is reported too
        if (process.platform === 'win32' && !changedSince(join(dir, filename), buildStarted)) return
        if (filename.endsWith('_comments.html')) {
          devLog(filename)
        } else {
          devLog(filename)
        }
        triggerBuild(filename)
      })
      watchers.push(watcher)
    }
  }

  // Initial build to ensure output dir is up to date
  if (!noBuild) void runBuild('startup')

  // Graceful shutdown. Never rejects, so the process always reaches process.exit.
  const cleanup = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('')
    devLog('Shutting down...')
    if (buildTimer) clearTimeout(buildTimer)
    for (const w of watchers) w.close()
    commentsProcess?.kill()
    try {
      await Promise.race([vite.close(), new Promise((r) => setTimeout(r, 2000))])
    } catch (err) {
      devErr(`Vite did not close cleanly: ${err instanceof Error ? err.message : err}`)
    }
    devLog('Cleaned up')
    process.exit(0)
  }

  // Keyboard shortcuts (TTY only)
  if (hasKeyboard) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (key: string) => {
      if (key === 'r' || key === 'R') {
        triggerBuild('manual')
      } else if (key === 'q' || key === 'Q' || key === '') {
        void cleanup()
      }
    })
  }

  process.on('SIGINT', () => void cleanup())
  process.on('SIGTERM', () => void cleanup())
}
