import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { browserFile, STYLESHEET } from '../browser-files.ts'

let dir: string
let browser: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-editor-browser-'))
  browser = join(dir, 'browser')
  await mkdir(join(browser, 'core'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the browser code of the editor', () => {
  it('serves a module as JavaScript, its imports as they are, with its source map', async () => {
    await writeFile(join(browser, 'core', 'dom.ts'), "import { a } from './texts.ts'\nexport const b: number = a\n")
    const file = await browserFile('/__hadley/editor/core/dom.ts', browser)
    assert.equal(file?.type, 'application/javascript; charset=utf-8')
    assert.match(file!.body, /import \{ a \} from "\.\/texts\.ts";\nexport const b = a;/)
    assert.match(file!.body, /\/\/# sourceMappingURL=data:application\/json;base64,/)
  })

  it('serves no other name, no missing file, and nothing a link leads to outside browser/', async () => {
    await writeFile(join(browser, 'main.ts'), 'export {}\n')
    await writeFile(join(dir, 'outside.ts'), 'export const secret = 1\n')
    await symlink(join(dir, 'outside.ts'), join(browser, 'link.ts'))
    await writeFile(join(browser, 'tsconfig.json'), '{}\n')
    for (const path of [
      '/__hadley/editor/link.ts',
      '/__hadley/editor/../outside.ts',
      '/__hadley/editor/core/../main.ts',
      '/__hadley/editor//main.ts',
      '/__hadley/editor/Main.ts',
      '/__hadley/editor/main.js',
      '/__hadley/editor/tsconfig.json',
      '/__hadley/editor/missing.ts',
      '/__hadley/editor/',
    ])
      assert.equal(await browserFile(path, browser), undefined, path)
    assert.ok(await browserFile('/__hadley/editor/main.ts', browser))
  })

  it('makes one stylesheet of its files, in their order and unchanged', async () => {
    await writeFile(join(browser, 'tokens.css'), ':root { --a: 1 }\n')
    await writeFile(join(browser, 'bar.css'), '.bar { color: red !important }\n')
    const file = await browserFile(STYLESHEET, browser, ['tokens.css', 'bar.css'])
    assert.deepEqual(file, {
      type: 'text/css; charset=utf-8',
      body: ':root { --a: 1 }\n\n.bar { color: red !important }\n',
    })
    await assert.rejects(browserFile(STYLESHEET, browser, ['tokens.css', 'gone.css']), /lacks gone\.css/)
  })

  it('serves its own entry', async () => {
    const file = await browserFile('/__hadley/editor/main.ts')
    assert.match(file?.body ?? '', /\/__hadley\/editor\/editor\.css/)
    assert.equal((await browserFile(STYLESHEET))?.type, 'text/css; charset=utf-8')
  })
})
