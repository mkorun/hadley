import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import quad from '@mkorun/quad'
import { parse as parseLima, parseCore } from '@limaformat/lima'
import { build } from '../../index.ts'
import { CONTENT_ROOTS, pageFiles } from '../bundles.ts'
import { frontMatterFiles } from '../build-files.ts'
import compileTemplates, { compileHeading } from '../compile-templates.ts'
import { readCoverMatrices } from '../cover-matrices.ts'
import { feedPages, feedUrl } from '../feed.ts'
import { KNOWN_TYPES, OG_POSITIONS, STATES } from '../front-matter.ts'
import { BLANK, STARTERS, THEMES, init, namesOf, starterLanguages } from '../init.ts'
import loadSite, { parsePage } from '../load-site.ts'
import { Output } from '../output.ts'
import { buildCovers, buildFiles, checkSitePaths } from '../page-files.ts'
import { notesFor, pageContext } from '../page-context.ts'
import { personFor, resolvePersons } from '../persons.ts'
import { pathsBelow } from '../platform.ts'
import { settle } from '../problems.ts'
import { renderContent } from '../render-content.ts'
import { fieldSchema, readConfig, readMetaFiles } from '../site-config.ts'
import type { ImageCache, ImageConfigs } from '../images.ts'
import type { Page, Site } from '../site.ts'
import { siteView } from '../site-view.ts'
import { assetsFor, planTheme } from '../theme-files.ts'
import { quietly } from './helpers.ts'

// Every optional field in docs/content.md, absent and with its documented kinds/values. Covers use each file's
// existing image; every starter cover is exercised, and every page is also rendered without one.
const OPTIONAL_PAGE_FIELDS: Record<string, readonly string[]> = {
  title: ['Fixture title'],
  subtitle: ['Fixture subtitle'],
  linktext: ['Short title'],
  htmlTitle: ['Browser title'],
  description: ['A description'],
  publishFrom: ['2026-01-01', '2999-01-01'],
  updatedAt: ['2999-01-02'],
  status: STATES,
  cover: [],
  coverStyle: ['ink'],
  'og:image': ['false', 'https://images.example/cover.jpg'],
  ogPosition: OG_POSITIONS,
  category: ['Fixture category'],
  tags: ['[one, two]'],
  author: ['Fixture author'],
  archetype: ['deep-dive', 'case-study', 'blueprint', 'manifesto', 'til', 'heuristic', 'snippet', 'spark'],
  ai_assisted: ['true', 'false'],
  noindex: ['true', 'false'],
  sitemap: ['true', 'false'],
  markdown: ['true', 'false'],
  urlPath: ['/fixture/'],
  link: ['https://other.example/piece'],
  template: ['page', 'article', 'note'],
  type: [...KNOWN_TYPES],
  vgwort_pixel: ["'123456789'"],
}
// Requirements of hadley itself, independent of the starter and its templates (docs/content.md).
const REQUIRED_PAGE_FIELDS = {
  title: 'a title in front matter or a first # heading',
  publishFrom: 'a note needs a date',
}
// No person field is intrinsically required. A config naming a profile requires that link; omission cases remove
// the profile reference too. Likewise, changing a template need not keep the cover config of the previous template.
const OPTIONAL_PERSON_FIELDS = [
  'name',
  'url',
  'bio',
  'email',
  'mobile',
  'address',
  'co',
  'street',
  'postalCode',
  'locality',
  'country',
  'mastodon',
  'bluesky',
  'linkedin',
  'github',
]

function setField(source: string, name: string, value: string | undefined): string {
  const lines = source.split('\n')
  const end = lines.indexOf('---', 1)
  assert.ok(lines[0] === '---' && end > 0)
  const start = lines.findIndex((line, i) => i > 0 && i < end && line.startsWith(`${name}:`))
  if (start !== -1) {
    let stop = start + 1
    while (stop < end && (lines[stop]!.startsWith(' ') || lines[stop] === '')) stop++
    lines.splice(start, stop - start)
  }
  if (value !== undefined) lines.splice(1, 0, `${name}: ${value}`)
  return lines.join('\n')
}

function sourceFor(page: Page, field: string, value: string | undefined): string {
  let source = page.source
  if (field === 'subtitle' || field === 'title') {
    const head = page.doc.heads?.[field]
    if (head) source = source.slice(0, head.start) + source.slice(head.end)
  }
  source = setField(source, field, value)
  if (field === 'title' && value === undefined) {
    const end = source.indexOf('\n---', 4) + 4
    source = `${source.slice(0, end)}\n# ${page.metadata.title}\n${source.slice(end)}`
  }
  if (field === 'template' && value !== page.template) source = setField(source, 'cover', undefined)
  if (field === 'type' && value === 'note' && !page.metadata.publishFrom)
    source = setField(source, 'publishFrom', '2026-01-01')
  return source
}

function personOmissions(
  person: Record<string, unknown>,
  languages: readonly string[],
): [string, Record<string, unknown>][] {
  const cases: [string, Record<string, unknown>][] = []
  for (const [key, value] of Object.entries(person)) {
    assert.ok(OPTIONAL_PERSON_FIELDS.includes(key) || languages.includes(key), `classify person.${key}`)
    const dropped = { ...person }
    delete dropped[key]
    cases.push([key, dropped])
    if (value && typeof value === 'object' && !Array.isArray(value))
      for (const child of Object.keys(value)) {
        assert.ok(OPTIONAL_PERSON_FIELDS.includes(child), `classify person.${key}.${child}`)
        const block = { ...(value as Record<string, unknown>) }
        delete block[child]
        cases.push([`${key}.${child}`, { ...person, [key]: block }])
      }
  }
  return cases
}

const dir = await mkdtemp(join(tmpdir(), 'hadley-starter-undefined-'))
after(() => rm(dir, { recursive: true, force: true }))
const themes = await namesOf(THEMES)
const starters = await namesOf(STARTERS)
const contentDocs = (await readFile(new URL('../../../../docs/content.md', import.meta.url), 'utf8')).split('\n')
const tableStart = contentDocs.findIndex((line) => line.startsWith('| Field |')) + 2
const documentedFields = new Set<string>()
for (const line of contentDocs.slice(tableStart)) {
  if (!line.startsWith('|')) break
  for (const match of line.split('|')[1]!.matchAll(/`([^`]+)`/g)) documentedFields.add(match[1]!)
}
// init copies these files unchanged. Compile them once per theme, outside the content variations.
const compiled = new Map(
  await Promise.all(
    themes.map(async (theme) => {
      const basedir = join(THEMES, theme, 'templates')
      const options = {
        includes: { basedir, import: (path: string, enc: string) => readFile(path, enc as BufferEncoding) },
      }
      return [
        theme,
        {
          templates: await compileTemplates({ ...options, strictUndefined: true }),
          relaxed: await compileTemplates({ ...options, strictUndefined: false }),
          heading: await compileHeading(options),
          themeFiles: await planTheme(join(THEMES, theme), true),
        },
      ] as const
    }),
  ),
)

describe('all starter content with strictUndefined', () => {
  it('names every front matter field documented in docs/content.md', () => {
    assert.deepEqual(Object.keys(OPTIONAL_PAGE_FIELDS).sort(), [...documentedFields].sort())
  })
  for (const starter of starters) {
    for (const theme of starter === BLANK ? themes : [starter])
      for (const selection of ['en', 'de', 'all'])
        it(`${starter}/${theme}, --language ${selection}`, async (t) => {
          const languages = selection === 'all' ? await starterLanguages(starter) : [selection]
          const root = join(dir, `${starter}-${theme}-${selection}`)
          await init(root, languages, theme, starter)
          const built = await quietly(() => build(root, 'publish'))
          const partials = await readMetaFiles(root)
          const config = await readConfig(root, partials)
          assert.equal(Object.hasOwn(config, 'strictBraces'), false)
          assert.equal(config.strictUndefined, true)
          const schema = await fieldSchema(config)
          const site = await loadSite(root, true)
          const reading = {
            config,
            partials,
            schema,
            defaultLanguage: site.defaultLanguage,
            isPublish: true,
            today: site.today,
          }
          const { templates, relaxed, heading, themeFiles } = compiled.get(theme)!
          const matrices = await readCoverMatrices(root)
          const assetNames = new Map([...themeFiles].map(([path, file]) => [path, file.name]))
          const syntax = built.planned.find((name) => /^assets\/css\/syntax-highlighting[.]/.test(name))
          if (syntax) assetNames.set('assets/css/syntax-highlighting.css', syntax)
          const output = new Output(join(root, '.hadley/context-files'))
          for (const language of Object.values(site.content))
            for (const page of Object.values(language.pages))
              output.claim(page.urlPath.slice(1) + 'index.html', page.file)
          for (const file of themeFiles.values()) output.claim(file.name, file.source)
          if (syntax) output.claim(syntax, 'syntax stylesheet')
          const filesOptions = {
            site,
            siteDir: root,
            output,
            og: undefined,
            isPublish: true,
            imageCache: JSON.parse(await readFile(join(root, '.hadley/cache/images.json'), 'utf8')) as ImageCache,
            imageConfigs: (name: string) => (templates[name]?.images ?? {}) as ImageConfigs,
          }
          const files = await buildFiles(filesOptions)
          settle(files.problems, true)
          settle((await buildCovers(filesOptions)).problems, true)
          settle(checkSitePaths(filesOptions, files.requests, assetNames), true)
          settle(renderContent(site, true, undefined, heading), true)
          const assets = assetsFor(assetNames)
          let count = 0
          const contextFor = (page: Page, current: Site = site) => {
            const language = current.content[page.language]!
            return pageContext(page, {
              site: current,
              view: siteView(language, page.language),
              notes: notesFor(current, page.language, true),
              assets,
              coverMatrices: matrices,
              isPublish: true,
              og: false,
              comments: undefined,
              feed: { url: feedUrl(current, page.language), pages: feedPages(current, page.language) },
            })
          }
          const render = (page: Page, current: Site = site) => {
            count++
            return templates[page.template]!.render(contextFor(page, current)) as string
          }
          const covered = new Set<string>()
          const valuesCovered = new Set<string>()
          for (const contentRoot of CONTENT_ROOTS)
            for (const file of await pageFiles(join(root, 'content'), contentRoot, site.defaultLanguage)) {
              const page = site.content[file.language]!.pages[file.bundleId]!
              covered.add(file.file)
              const initial = render(page)
              assert.equal(initial, relaxed[page.template]!.render(contextFor(page)), file.file)
              assert.equal(
                quad(initial, { stripComments: true }),
                await readFile(join(root, '.hadley/publish', page.urlPath, 'index.html'), 'utf8'),
                file.file,
              )
              const front = parseCore(page.source.slice(4, page.source.indexOf('\n---', 4))) as Record<string, unknown>
              for (const field of Object.keys(front))
                assert.ok(Object.hasOwn(OPTIONAL_PAGE_FIELDS, field), `${file.file}: classify ${field}`)
              for (const [field, values] of Object.entries(OPTIONAL_PAGE_FIELDS)) {
                // Every file loses every field. Additional values need one example per template and language;
                // states are kept on every file because they decide whether that particular page is listed.
                const key = `${page.template}/${file.language}/${field}`
                const examples = field === 'status' || !valuesCovered.has(key) ? [...values] : []
                if (field === 'og:image' && typeof page.metadata.cover === 'string') examples.push(page.metadata.cover)
                valuesCovered.add(key)
                for (const value of [undefined, ...examples]) {
                  const parse = () =>
                    parsePage(
                      sourceFor(page, field, value),
                      file,
                      contentRoot,
                      reading,
                      site.content[file.language]!.origin,
                    )
                  if (field === 'urlPath' && value !== undefined && file.collectionId === 'errors') {
                    await assert.rejects(parse, /an error page takes no urlPath/)
                    continue
                  }
                  const { page: parsed, problems } = await parse()
                  assert.deepEqual(
                    problems.filter((problem) => !problem.hint),
                    [],
                    `${file.file}: ${field}=${value}`,
                  )
                  if (field === 'type' && value === 'note') {
                    const withoutDate = setField(sourceFor(page, field, value), 'publishFrom', undefined)
                    const note = await parsePage(
                      withoutDate,
                      file,
                      contentRoot,
                      reading,
                      site.content[file.language]!.origin,
                    )
                    assert.ok(note.problems.some((problem) => problem.message === 'the note requires publishFrom'))
                  }
                  if (parsed.metadata.author && typeof parsed.metadata.author === 'object')
                    parsed.metadata.author = personFor(
                      parsed.metadata.author as Record<string, unknown>,
                      file.language,
                      site,
                      file.file,
                    )
                  const changed = { ...page, ...parsed }
                  if (!parsed.metadata.cover || !templates[parsed.template]?.images || field === 'cover') {
                    delete changed.coverImageHtml
                    delete changed.listCover
                  }
                  if (field === 'og:image') {
                    const named = await frontMatterFiles(changed, site.content[file.language]!.origin)
                    assert.deepEqual(named.failures, [])
                    changed.ogImage = named.ogFile
                      ? new URL(named.ogFile.rel, site.content[file.language]!.origin + changed.urlPath).href
                      : named.ogImage
                  }
                  const language = site.content[file.language]!
                  const listed = { ...language.listed }
                  if (changed.outputs.listed) listed[changed.id] = changed
                  else delete listed[changed.id]
                  const translations = { ...site.translationMappings[changed.id] }
                  if (changed.outputs.listed) translations[file.language] = changed.urlPath
                  else delete translations[file.language]
                  const translationMappings = { ...site.translationMappings }
                  if (Object.keys(translations).length) translationMappings[changed.id] = translations
                  else delete translationMappings[changed.id]
                  const current: Site = {
                    ...site,
                    content: {
                      ...site.content,
                      [file.language]: { ...language, pages: { ...language.pages, [changed.id]: changed }, listed },
                    },
                    translationMappings,
                  }
                  assert.doesNotThrow(() => render(changed, current), `${file.file}: ${field}=${value}`)
                  if (page.articleLike && (value === undefined || field === 'status' || field === 'publishFrom'))
                    for (const other of Object.values(current.content[file.language]!.pages))
                      if (other.template === 'home' || other.template === 'feed') render(other, current)
                }
              }
              for (const [field, reason] of Object.entries(REQUIRED_PAGE_FIELDS)) {
                let source = setField(page.source, field, undefined)
                if (field === 'title') {
                  const title = page.doc.heads?.title
                  if (title) source = source.slice(0, title.start) + source.slice(title.end)
                } else if (page.type !== 'note') continue
                const { problems } = await parsePage(
                  source,
                  file,
                  contentRoot,
                  reading,
                  site.content[file.language]!.origin,
                )
                assert.ok(
                  problems.some((problem) => !problem.hint),
                  `${file.file}: ${field}: ${reason}`,
                )
              }
            }
          const markdown = (await pathsBelow(join(root, 'content')))
            .filter((file) => file.endsWith('.md'))
            .map((file) => join(root, 'content', file))
          assert.deepEqual([...covered].sort(), markdown.sort(), 'every content file, including the default language')
          for (const [key, person] of Object.entries(partials)) {
            assert.ok(key.startsWith('persons/'), `classify meta entry ${key}`)
            assert.ok(person && typeof person === 'object' && !Array.isArray(person))
            for (const [field, changed] of personOmissions(person as Record<string, unknown>, languages)) {
              const replaced = { ...partials, [key]: changed }
              const nextConfig = await readConfig(root, replaced)
              nextConfig.profiles = []
              const current: Site = { ...site, config: nextConfig, content: {} }
              for (const [lang, language] of Object.entries(site.content)) {
                current.content[lang] = {
                  ...language,
                  pages: Object.fromEntries(
                    Object.entries(language.pages).map(([id, page]) => {
                      const raw = parseLima(page.source.slice(4, page.source.indexOf('\n---', 4)), {
                        partials: replaced,
                      }) as { author?: string | Record<string, unknown> }
                      // resolvePersons, below, reads the author for the page's language
                      const author = raw.author === undefined ? {} : { author: raw.author }
                      return [id, { ...page, metadata: { ...page.metadata, ...author } }]
                    }),
                  ),
                }
              }
              resolvePersons(current)
              for (const language of Object.values(current.content))
                for (const page of Object.values(language.pages))
                  assert.doesNotThrow(() => render(page, current), `${key} without ${field}`)
            }
          }
          t.diagnostic(`${covered.size} content files; ${count} template renders`)
        })
  }
})
