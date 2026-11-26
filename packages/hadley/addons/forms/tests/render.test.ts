import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THEMES, namesOf } from '../../../lib/init.ts'
import { readLocales, templateOptions } from '../../../lib/site-config.ts'
import { compileComments, renderComments, sampleComments, sampleCounts } from '../render.ts'
import type { PublicComment } from '../merge.ts'

const themes = await namesOf(THEMES)
const STRICT = templateOptions({ strictUndefined: true })
const words: Record<string, Partial<Record<Intl.LDMLPluralRule, string>>> = {
  en: { one: 'comment', other: 'comments' },
  de: { one: 'Kommentar', other: 'Kommentare' },
  fr: { one: 'commentaire', many: 'commentaires', other: 'commentaires' },
  es: { one: 'comentario', many: 'comentarios', other: 'comentarios' },
  it: { one: 'commento', many: 'commenti', other: 'commenti' },
}
const comment = (id: string): PublicComment => ({
  id,
  parent_comment_id: null,
  name: '<b>Nora</b>',
  submitted_at: '2026-01-01T12:00:00Z',
  text: 'A <script>\nsecond line\n\nNew paragraph.',
  author_reply: false,
  comments: [],
})

// a site for each bundled theme, with the theme alone
let dir: string
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-comment-heading-'))
  for (const theme of themes) await cp(join(THEMES, theme), join(dir, theme, 'theme'), { recursive: true })
})
after(() => rm(dir, { recursive: true, force: true }))

describe('the sample comments of the build check', () => {
  it('come in none, one and two, and in the smallest count from 3 to 100 of each further plural category', () => {
    assert.deepEqual(sampleCounts('en'), [0, 1, 2])
    assert.deepEqual(sampleCounts('ja'), [0, 1, 2]) // one category, and two comments all the same
    assert.deepEqual(sampleCounts('fr'), [0, 1, 2]) // many needs a million
    assert.deepEqual(sampleCounts('pl'), [0, 1, 2, 5]) // one, few, many; only fractions select other
    assert.deepEqual(sampleCounts('ar'), [0, 1, 2, 3, 11, 100]) // none alone selects zero
    assert.deepEqual(sampleCounts('lv'), [0, 1, 2, 10]) // none selects zero, and so does ten
  })

  it('come as none, one and two in a language without plural rules, or with a name that is no language tag', (t) => {
    assert.deepEqual(sampleCounts('tlh'), [0, 1, 2])
    assert.deepEqual(sampleCounts('en_US'), [0, 1, 2])
    // not by the rules of the language of the machine, which Intl.PluralRules gives for a language it does not know
    t.mock.method(Intl.PluralRules, 'supportedLocalesOf', () => [])
    assert.deepEqual(sampleCounts('pl'), [0, 1, 2])
    t.mock.restoreAll()
    assert.deepEqual(sampleCounts('pl'), [0, 1, 2, 5])
  })

  it('are as many comments as counted, each its own, the first with the reply of the owner', () => {
    const comments = sampleComments(3)
    assert.equal([...comments].length, 3)
    assert.equal(new Set(comments.map((comment) => comment.id)).size, 3)
    assert.deepEqual(
      comments.map((comment) => comment.comments.map((reply) => reply.author_reply)),
      [[true], [], [true]],
    )
    assert.deepEqual(comments[0]!.paragraphs, [['A first line', 'and a second.'], ['A second paragraph.']])
    assert.deepEqual(sampleComments(0), [])
  })
})

describe('the comment headings of the bundled themes', () => {
  for (const theme of themes) {
    for (const [language, forms] of Object.entries(words)) {
      it(`${theme}: writes the heading in ${language} for every count a build checks`, async () => {
        const template = await compileComments(join(dir, theme, 'theme'), STRICT)
        const texts = (await readLocales(join(dir, theme), [language], 'en'))[language]!
        // every form of the language, also one the build does not ask for: many in French, at a million
        assert.deepEqual({ ...(texts.comments as { heading: object }).heading }, forms)
        const rules = new Intl.PluralRules(language)
        for (const count of sampleCounts(language)) {
          const comments = sampleComments(count).map((comment) => ({ ...comment, comments: [] }))
          const html = await template.render(comments, language, texts)
          if (count === 0) assert.doesNotMatch(html, /<h2/)
          else assert.ok(html.includes(`>${count} ${forms[rules.select(count)]}</h2>`), `${language}/${count}: ${html}`)
        }
      })

      it(`${theme}: renders the real comments partial in ${language} with strictUndefined`, async () => {
        for (const count of [1, 2]) {
          const tree = Array.from({ length: count }, (_, i) => comment(String(i)))
          tree[0]!.comments.push(comment('reply'))
          const commentsJsonPath = join(dir, `${theme}-${language}-${count}.json`)
          await writeFile(commentsJsonPath, JSON.stringify(tree))
          const html = await renderComments({
            siteDir: join(dir, theme),
            defaultLanguage: 'en',
            commentsJsonPath,
            language,
            templateOptions: STRICT,
          })
          // the heading counts the reply too
          const category = new Intl.PluralRules(language).select(count + 1)
          assert.ok(html.includes(`>${count + 1} ${forms[category]}</h2>`), html)
          assert.match(html, /id="comment-reply"/)
          assert.match(html, /&lt;b&gt;Nora&lt;\/b&gt;/)
          assert.match(html, /A &lt;script&gt;/)
          assert.doesNotMatch(html, /<script>|<b>/)
        }
      })
    }
  }
})

describe('the count of comments a theme gets', () => {
  // three comments, the first and the third with a reply
  const tree = () => {
    const comments = ['1', '2', '3'].map(comment)
    comments[0]!.comments.push(comment('1-reply'))
    comments[2]!.comments.push(comment('3-reply'))
    return comments
  }
  const render = async (siteDir: string) => {
    const commentsJsonPath = join(siteDir, 'comments.json')
    await writeFile(commentsJsonPath, JSON.stringify(tree()))
    return renderComments({ siteDir, defaultLanguage: 'en', commentsJsonPath, language: 'en', templateOptions: STRICT })
  }

  for (const theme of themes)
    it(`${theme}: counts the comments and their replies in the heading`, async () => {
      assert.match(await render(join(dir, theme)), />5 comments<\/h2>/)
    })

  it('leaves a theme copied earlier its own count', async () => {
    const siteDir = join(dir, 'copied-earlier')
    await mkdir(join(siteDir, 'theme/templates/partials'), { recursive: true })
    await writeFile(
      join(siteDir, 'theme/templates/partials/comments.sort'),
      '{@const count = comments | length}\n<h2>{ count }</h2>\n',
    )
    assert.match(await render(siteDir), /<h2>3<\/h2>/)
  })
})
