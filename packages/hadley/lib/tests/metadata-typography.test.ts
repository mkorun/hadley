import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import loadSite from '../load-site.ts'
import { renderContent } from '../render-content.ts'

// Front matter shown outside the document gets typography in the page's language, as the content does.

let dir: string
const cwd = process.cwd()

const page = (title: string, description: string) =>
  `---\npublishFrom: 2026-01-01\ntitle: ${title}\ndescription: ${description}\n---\nInhalt.\n`

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-metadata-typography-test-'))
  const site = join(dir, 'sites', 'test-site')
  await mkdir(join(site, 'content', 'articles', '[a]'), { recursive: true })
  await mkdir(join(site, 'content', 'articles', '[b]'), { recursive: true })
  await writeFile(
    join(site, 'config.lima'),
    'site:\n  origin: https://test.example\n  default:\n    language: de\n    title: Test\ntypography:\n  enabled: true\n',
  )
  await writeFile(join(site, 'content', 'articles', '[a]', 'a.md'), page('A -- B', `'"mal eben" -- schnell...'`))
  await writeFile(
    join(site, 'content', 'articles', '[b]', 'b.md'),
    '---\npublishFrom: 2026-01-01\ntitle: B\n---\n"Zitat" -- Text.\n',
  )
  process.chdir(dir)
})

after(async () => {
  process.chdir(cwd)
  await rm(dir, { recursive: true, force: true })
})

describe('front matter typography', () => {
  it('sets the title and the description typographically, and the description written from the text too', async () => {
    const site: any = await loadSite(join('sites', 'test-site'), false, false)
    renderContent(site, false)
    const pages = site.content.de.pages
    assert.equal(pages.a.metadata.title, 'A – B')
    assert.equal(pages.a.metadata.description, '„mal eben“ – schnell…')
    assert.equal(pages.b.metadata.description, '„Zitat“ – Text.')
  })
})
