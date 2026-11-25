import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@limaformat/lima'
import { THEMES, namesOf } from '../../../lib/init.ts'
import { templateOptions } from '../../../lib/site-config.ts'
import { renderComments } from '../render.ts'

const themes = await namesOf(THEMES)
const words: Record<string, Partial<Record<Intl.LDMLPluralRule, string>>> = {
  en: { one: 'comment', other: 'comments' },
  de: { one: 'Kommentar', other: 'Kommentare' },
  fr: { one: 'commentaire', many: 'commentaires', other: 'commentaires' },
  es: { one: 'comentario', many: 'comentarios', other: 'comentarios' },
  it: { one: 'commento', many: 'commenti', other: 'commenti' },
}

let dir: string
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-comment-heading-'))
})
after(() => rm(dir, { recursive: true, force: true }))

describe('the comment headings of the bundled themes', () => {
  for (const theme of themes) {
    it(`${theme}: every language supplies every plural category`, async () => {
      const i18n = join(THEMES, theme, 'i18n')
      for (const file of await readdir(i18n)) {
        if (!file.endsWith('.lima')) continue
        const language = file.slice(0, -'.lima'.length)
        const texts = parse(await readFile(join(i18n, file), 'utf8')) as {
          comments: { heading?: Partial<Record<Intl.LDMLPluralRule, string>> }
        }
        for (const category of new Intl.PluralRules(language).resolvedOptions().pluralCategories) {
          const form = texts.comments.heading?.[category]
          assert.ok(typeof form === 'string' && form.length > 0, `${theme}/${file}: comments.heading.${category}`)
        }
      }
    })

    for (const [language, forms] of Object.entries(words))
      it(`${theme}: renders the heading in ${language} through the comments tool`, async () => {
        const themePath = join(dir, `${theme}-${language}`)
        await mkdir(join(themePath, 'templates'), { recursive: true })
        await cp(join(THEMES, theme, 'i18n'), join(themePath, 'i18n'), { recursive: true })
        const source = await readFile(join(THEMES, theme, 'templates/partials/comments.sort'), 'utf8')
        const heading = /<h2\b[^>]*>.*<\/h2>/.exec(source)?.[0]
        assert.ok(heading, `${theme}: comments.sort has a heading`)
        // Render the actual heading with a string's length, without a million comment bodies for the many category.
        await writeFile(
          join(themePath, 'templates/comments.sort'),
          `{#snippet heading(comments)}${heading}{/snippet}{@render heading(comments[0].text)}`,
        )
        const rules = new Intl.PluralRules(language)
        const selected = new Set<Intl.LDMLPluralRule>()
        for (const count of [0, 1, 2, 1_000_000]) {
          const category = rules.select(count)
          selected.add(category)
          const commentsJsonPath = join(themePath, 'comments.json')
          const commentsHtmlPath = join(themePath, '_comments.html')
          await writeFile(commentsJsonPath, JSON.stringify([{ text: 'x'.repeat(count), comments: [] }]))
          await renderComments({
            themePath,
            commentsJsonPath,
            commentsHtmlPath,
            language,
            templateOptions: templateOptions({ strictBraces: true, strictUndefined: true }),
          })
          const html = await readFile(commentsHtmlPath, 'utf8')
          assert.ok(html.includes(`>${count} ${forms[category]}</h2>`), `${language}/${category}: ${html}`)
        }
        assert.deepEqual([...selected].sort(), rules.resolvedOptions().pluralCategories.slice().sort())
      })
  }
})
