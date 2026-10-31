import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import loadSite from '../load-site.ts'
import { renderContent } from '../render-content.ts'

const SITE = 'test-site'
let tmpDir: string
let site: Awaited<ReturnType<typeof loadSite>>
const originalCwd = process.cwd()

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'hadley-notes-test-'))

  const siteDir = join(tmpDir, 'sites', SITE)
  const contentDir = join(siteDir, 'content')

  await mkdir(siteDir, { recursive: true })
  await writeFile(
    join(siteDir, 'config.lima'),
    `site:
  origin: https://test.example
  default:
    language: de
    title: Test Site
`,
  )

  // articles/[my-article]/
  await mkdir(join(contentDir, 'articles', '[my-article]'), { recursive: true })
  await writeFile(
    join(contentDir, 'articles', '[my-article]', 'my-article.md'),
    `---
publishFrom: 2026-01-01
title: Mein Artikel
---
Inhalt.
`,
  )

  // pages/[about]/
  await mkdir(join(contentDir, 'pages', '[about]'), { recursive: true })
  await writeFile(
    join(contentDir, 'pages', '[about]', 'about.md'),
    `---
publishFrom: 2026-01-01
title: Über uns
---
Inhalt der Seite.
`,
  )

  // notes/ — a valid solitaire file
  await mkdir(join(contentDir, 'notes'), { recursive: true })
  await writeFile(
    join(contentDir, 'notes', 'standalone.md'),
    `---
publishFrom: 2026-01-01
title: Standalone Note
---
Inhalt der Note.
`,
  )

  // notes/ — ignored files
  await writeFile(
    join(contentDir, 'notes', 'README.md'),
    `---
title: Soll ignoriert werden (UPPERCASE)
---
`,
  )
  await writeFile(
    join(contentDir, 'notes', '_private.md'),
    `---
title: Soll ignoriert werden (Unterstrich-Präfix)
---
`,
  )

  // notes/@vs/ — a grouped solitaire note
  await mkdir(join(contentDir, 'notes', '@vs'), { recursive: true })
  await writeFile(
    join(contentDir, 'notes', '@vs', 'a-vs-b.md'),
    `---
publishFrom: 2026-01-01
title: A vs B
---
Inhalt der gruppierten Note.
`,
  )

  process.chdir(tmpDir)
  site = await loadSite(join('sites', SITE), false, false)
  renderContent(site, false)
})

after(async () => {
  process.chdir(originalCwd)
  await rm(tmpDir, { recursive: true })
})

const pages = () => site.content['de'].pages

describe('solitaire note scanning: root level', () => {
  test('loads a standalone note as a page', () => {
    assert.notEqual(pages()['standalone'], undefined)
  })

  test('a standalone note has type: note', () => {
    assert.equal(pages()['standalone'].type, 'note')
  })

  test('a standalone note has no collection', () => {
    assert.deepEqual(pages()['standalone'].collections, [])
  })

  test('a standalone note has rendered markup', () => {
    assert.ok(pages()['standalone']?.markup?.includes('Inhalt der Note'))
  })
})

describe('solitaire note scanning: grouped notes (@vs)', () => {
  test('loads a grouped note in @vs', () => {
    assert.notEqual(pages()['a-vs-b'], undefined)
  })

  test('a grouped note has type: note', () => {
    assert.equal(pages()['a-vs-b'].type, 'note')
  })

  test('a grouped note has collection vs', () => {
    assert.deepEqual(pages()['a-vs-b'].collections, ['vs'])
  })
})

describe('solitaire note scanning: ignored files', () => {
  test('ignores README.md (UPPERCASE)', () => {
    assert.equal(pages()['README'], undefined)
  })

  test('ignores _private.md (underscore prefix)', () => {
    assert.equal(pages()['_private'], undefined)
  })
})

describe('type from the content root', () => {
  test('an article bundle in articles/ has type: article', () => {
    assert.equal(pages()['my-article']?.type, 'article')
  })

  test('a page in pages/ has type: page', () => {
    assert.equal(pages()['about']?.type, 'page')
  })
})

describe('notes in the stream context', () => {
  test('all notes are available in site.content[lang].pages', () => {
    const noteIds = Object.keys(pages()).filter((id) => pages()[id].type === 'note')
    assert.ok(noteIds.includes('standalone'))
    assert.ok(noteIds.includes('a-vs-b'))
  })

  test('loads exactly 2 notes (none of the ignored ones)', () => {
    const noteIds = Object.keys(pages()).filter((id) => pages()[id].type === 'note')
    assert.equal(noteIds.length, 2)
  })
})
