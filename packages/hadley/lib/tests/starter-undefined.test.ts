import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCore } from '@limaformat/lima'
import { build } from '../../index.ts'
import { BLANK, STARTERS, THEMES, init, namesOf, starterLanguages } from '../init.ts'
import { slashed } from '../platform.ts'
import { collectOutput, compareOutputs } from '../../../../scripts/compare-builds.ts'

// All fields the starters set (docs/content.md). A new field must be classified here before the gate accepts it.
const OPTIONAL_PAGE_FIELDS = [
  'publishFrom',
  'author',
  'cover',
  'coverStyle',
  'category',
  'ai_assisted',
  'description',
  'noindex',
  'sitemap',
  'urlPath',
  'template',
]
const REQUIRED_PAGE_FIELDS = {
  title: /has no title/,
  'home.template': /has no page with the home template|cover .* is used nowhere/,
  'maintenance.template': /cover .* is used nowhere/,
}
const OPTIONAL_PERSON_FIELDS = [
  'name',
  'url',
  'email',
  'address',
  'address.street',
  'address.postalCode',
  'address.locality',
  'address.country',
]
// punch's config.lima names these profiles, so hadley requires them independently of template strictness.
const REQUIRED_PERSON_FIELDS = ['mastodon', 'bluesky', 'linkedin', 'github']

interface Field {
  name: string
  start: number
  end: number
  parent?: number
}

/** The mapping fields of a starter's Lima, including blocks and their children; Markdown ends at its front matter. */
function fieldsOf(text: string, markdown: boolean): Field[] {
  const lines = text.split('\n')
  const end = markdown ? lines.indexOf('---', 1) : lines.length
  assert.ok(!markdown || (lines[0] === '---' && end > 0), 'the starter page has Lima front matter')
  const fields: Field[] = []
  const parents: { indent: number; field: Field }[] = []
  for (let start = markdown ? 1 : 0; start < end; start++) {
    const match = /^( *)([\w:]+):(?: |$)/.exec(lines[start]!)
    if (!match) continue
    const indent = match[1]!.length
    while (parents.length && parents.at(-1)!.indent >= indent) parents.pop()
    const parent = parents.at(-1)?.field
    let stop = start + 1
    while (stop < end && (!lines[stop]!.trim() || lines[stop]!.startsWith(' '.repeat(indent + 1)))) stop++
    const field = {
      name: parent ? `${parent.name}.${match[2]}` : match[2]!,
      start,
      end: stop,
      ...(parent ? { parent: parent.start } : {}),
    }
    fields.push(field)
    parents.push({ indent, field })
  }
  return fields
}

function withoutField(text: string, field: Field): string {
  const lines = text.split('\n')
  lines.splice(field.start, field.end - field.start)
  // Leaving out the only bio keeps a language block a mapping; a bare `en:` would be null, which hadley refuses.
  if (field.parent !== undefined && field.start === field.parent + 1) {
    const parent = lines[field.parent]!
    const indent = parent.length - parent.trimStart().length
    const next = lines[field.start]
    if (next === undefined || next.length - next.trimStart().length <= indent) lines[field.parent] += ' {}'
  }
  return lines.join('\n')
}

async function quietly(run: () => Promise<unknown>): Promise<void> {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    await run()
  } finally {
    process.stdout.write = write
  }
}

let dir: string
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-starter-undefined-'))
})
after(() => rm(dir, { recursive: true, force: true }))

const themes = await namesOf(THEMES)
for (const starter of await namesOf(STARTERS)) {
  const languages = await starterLanguages(starter)
  const optionalPerson = [...OPTIONAL_PERSON_FIELDS, ...languages.flatMap((lang) => [lang, `${lang}.bio`])]
  const content = join(STARTERS, starter, 'content')
  const files = await Promise.all(
    (await readdir(content, { recursive: true }))
      .map((file) => slashed(file))
      .filter((file) => /\.(md|lima)$/.test(file))
      .sort()
      .map(async (file) => ({ file, original: await readFile(join(content, file), 'utf8') })),
  )
  for (const theme of starter === BLANK ? themes : [starter]) {
    describe(`${starter} with ${theme}, --language all, strictUndefined`, () => {
      let site: string
      let config: string
      const withStrict = (enabled: boolean) =>
        `${config.replace(/^strictUndefined:.*\n/gm, '')}\nstrictUndefined: ${enabled}\n`
      const publish = () => quietly(() => build(site, 'publish', { deferSearch: true }))
      before(async () => {
        site = join(dir, `${starter}-${theme}`)
        await init(site, languages, theme, starter)
        config = await readFile(join(site, 'config.lima'), 'utf8')
        await writeFile(join(site, 'config.lima'), withStrict(true))
      })

      it('builds its unchanged content with identical output when strictUndefined is enabled', async () => {
        await writeFile(join(site, 'config.lima'), withStrict(false))
        await quietly(() => build(site, 'publish'))
        const relaxed = collectOutput(join(site, '.hadley'))
        await writeFile(join(site, 'config.lima'), withStrict(true))
        await quietly(() => build(site, 'publish'))
        assert.deepEqual(compareOutputs(relaxed, collectOutput(join(site, '.hadley'))), [])
      })

      it('enables both strict template options in a new site', () => {
        const settings = parseCore(config) as Record<string, unknown>
        assert.equal(settings.strictBraces, true)
        assert.equal(settings.strictUndefined, true)
      })

      // Each build contains all languages; one omission per template and field covers the same absent value.
      const covered = new Set<string>()
      for (const { file, original } of files) {
        const markdown = file.endsWith('.md')
        const template = /^template: (\w+)$/m.exec(original)?.[1] ?? file.split('/')[0]
        for (const field of fieldsOf(original, markdown)) {
          let required: RegExp | undefined
          if (markdown) {
            const key = field.name === 'template' ? `${template}.template` : field.name
            required = REQUIRED_PAGE_FIELDS[key as keyof typeof REQUIRED_PAGE_FIELDS]
            assert.ok(
              required || OPTIONAL_PAGE_FIELDS.includes(field.name),
              `${starter}/${file}: classify ${field.name}`,
            )
          } else {
            assert.ok(file.startsWith('meta/persons/'), `${starter}/${file}: classify this meta entry`)
            if (REQUIRED_PERSON_FIELDS.includes(field.name)) required = /profiles: .*: the owner \(site.owner\) has no/
            assert.ok(required || optionalPerson.includes(field.name), `${starter}/${file}: classify ${field.name}`)
          }
          if (markdown) {
            const key = `${template}/${field.name}`
            if (covered.has(key)) continue
            covered.add(key)
          }
          it(`${file} without ${field.name}${required ? ' is required with either setting' : ' builds'}`, async () => {
            const path = join(site, 'content', file)
            await writeFile(path, withoutField(original, field))
            try {
              if (required) {
                for (const strict of [false, true]) {
                  await writeFile(join(site, 'config.lima'), withStrict(strict))
                  await assert.rejects(publish, required)
                }
              } else await publish()
            } finally {
              await writeFile(path, original)
              await writeFile(join(site, 'config.lima'), withStrict(true))
            }
          })
        }
      }
    })
  }
}
