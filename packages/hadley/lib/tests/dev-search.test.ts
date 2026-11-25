import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { init } from '../init.ts'

// A rebuild of `hadley dev` and its search index: a page that loads search.js after the reload finds the whole index
// (2026-11-08: Vite's overlay over a page in WebKit, whose index was still being written).

let dir: string
let site: string
let child: ChildProcess | undefined
let output = ''

async function unusedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, 'localhost')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected a TCP address')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

// how many builds `hadley dev` has finished, the search index included: it says this line as it starts, and after each
const finished = () => output.split('(no keyboard: not a terminal)').length - 2

/** Resolves once `hadley dev` has finished `count` builds. */
async function builds(count: number): Promise<void> {
  const deadline = Date.now() + 30_000
  while (finished() < count) {
    if (child?.exitCode !== null) throw new Error(`hadley dev stopped:\n${output}`)
    if (Date.now() > deadline) throw new Error(`hadley dev did not finish build ${count}:\n${output}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Whether the search index of the dev build is all there: Pagefind's script, its entry and each language's files. */
function indexWhole(): boolean {
  const pagefind = join(site, '.hadley', 'dev', 'pagefind')
  try {
    if (!existsSync(join(pagefind, 'pagefind.js'))) return false
    const entry = JSON.parse(readFileSync(join(pagefind, 'pagefind-entry.json'), 'utf8')) as {
      languages: Record<string, { hash: string; wasm: string }>
    }
    const languages = Object.values(entry.languages)
    return (
      languages.length > 0 &&
      languages.every(
        ({ hash, wasm }) =>
          existsSync(join(pagefind, `pagefind.${hash}.pf_meta`)) && existsSync(join(pagefind, `wasm.${wasm}.pagefind`)),
      )
    )
  } catch {
    return false // missing, or written half
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-dev-search-'))
  site = join(dir, 'site')
  // the blank starter turns the search on; enough articles that writing their index takes a while
  await init(site, ['en'], 'hems', 'blank')
  for (let n = 1; n <= 40; n++) {
    const bundle = join(site, 'content', 'articles', `[article-${n}]`)
    await mkdir(bundle, { recursive: true })
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} of article ${n}, with words to index.`)
    await writeFile(join(bundle, `article-${n}.md`), `---\ntitle: Article ${n}\n---\n${text.join('\n\n')}\n`)
  }
})

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  await rm(dir, { recursive: true, force: true })
})

describe('a rebuild of hadley dev', () => {
  it('sends the reload with the whole search index there, and leaves it whole', { timeout: 60_000 }, async () => {
    const port = await unusedPort()
    const home = join(dir, 'home')
    child = spawn(process.execPath, [join(import.meta.dirname, '..', '..', 'hadley.ts'), 'dev', '--port', `${port}`], {
      cwd: site,
      // nothing of the machine's own configuration
      env: { ...process.env, NO_COLOR: '1', HOME: home, XDG_CONFIG_HOME: join(home, 'config') },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await builds(1)
    assert.ok(indexWhole(), 'the first build writes the index')

    // a page, as Vite's client in it connects
    const socket = new WebSocket(`ws://localhost:${port}/`, 'vite-hmr')
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', reject)
    })
    try {
      const reloaded = new Promise<void>((resolve) =>
        socket.addEventListener('message', (event) => {
          if ((JSON.parse(String(event.data)) as { type: string }).type === 'full-reload') resolve()
        }),
      )
      await appendFile(join(site, 'content', 'articles', '[article-1]', 'article-1.md'), '\nA new paragraph.\n')
      await reloaded
      assert.ok(indexWhole(), 'the index is whole when the reload goes out')
      // and stays so until the build is done, which may have said so before the reload arrived
      let broken = 0
      let looked = 0
      for (let done = false; !done;) {
        done = finished() >= 2
        looked++
        if (!indexWhole()) broken++
        await new Promise((resolve) => setImmediate(resolve))
      }
      assert.equal(broken, 0, `the index was missing in ${broken} of ${looked} looks after the reload`)
      await builds(2)
    } finally {
      socket.close()
    }
  })
})
