import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { articleDirs, carriesToken } from '../index.ts'
import { renderComments } from '../render.ts'

// Where the comments tool publishes an approved comment, and the HTML it writes for the build
// (services/forms/CONTRACT.md C10).

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-comments-publish-test-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const file = async (path: string, text: string) => {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text)
}

describe('articleDirs', () => {
  it("finds an article's bundle wherever it lies under content/, and its language folder for another language", async () => {
    await file('content/articles/[plain]/plain.md', 'x')
    await file('content/articles/@series/[part]/part.md', 'x')
    await file('content/essays/[essay]/essay.md', 'x')
    await file('content/articles/[plain]/en/plain.md', 'x')
    const articleDir = await articleDirs(dir, 'de')
    assert.equal(articleDir('plain', 'de'), join(dir, 'content/articles/[plain]'))
    assert.equal(articleDir('plain', 'en'), join(dir, 'content/articles/[plain]/en'))
    assert.equal(articleDir('part', 'de'), join(dir, 'content/articles/@series/[part]'))
    assert.equal(articleDir('essay', 'de'), join(dir, 'content/essays/[essay]'))
  })

  it('finds no directory for an id no bundle has', async () => {
    await file('content/articles/[plain]/plain.md', 'x')
    assert.equal((await articleDirs(dir, 'de'))('missing', 'de'), undefined)
  })
})

const TEMPLATE = `{#snippet commentBlock(comment)}
<article class="comment{#if comment.author_reply} comment--author{/if}" id="comment-{ comment.id }">
  <strong>{ comment.name }</strong>
  <div class="comment-text">
    {#each comment.paragraphs as lines}<p>{#each lines as line, i}{#if i > 0}<br>{/if}{ line }{/each}</p>{/each}
  </div>
  {#each comment.comments as reply}{@render commentBlock(reply)}{/each}
</article>
{/snippet}
<h2>{ comments | length } { t.comments.headingPlural }</h2>
{#each comments as comment}{@render commentBlock(comment)}{/each}
`

const comment = (id: string, text: string, comments: unknown[] = []) => ({
  id,
  parent_comment_id: null,
  name: 'Nora <b>',
  submitted_at: '2026-10-27T10:00:00Z',
  text,
  author_reply: false,
  comments,
})

describe('renderComments', () => {
  it("writes a visitor's text escaped, its paragraphs and lines as <p> and <br>, with the theme's texts", async () => {
    await file('theme/templates/partials/comments.sort', TEMPLATE)
    await file('theme/i18n/de.lima', 'comments:\n  headingPlural: Kommentare\n')
    const tree = [comment('a', 'Hallo <script>x</script>\nzweite Zeile\n\nNeuer Absatz', [comment('b', 'Antwort')])]
    await file('comments.json', JSON.stringify(tree))
    const html = join(dir, '_comments.html')
    await renderComments({
      themePath: join(dir, 'theme'),
      commentsJsonPath: join(dir, 'comments.json'),
      commentsHtmlPath: html,
      language: 'de',
    })
    const written = await readFile(html, 'utf8')
    assert.match(written, /<h2>1 Kommentare<\/h2>/)
    assert.match(written, /<p>Hallo &lt;script&gt;x&lt;\/script&gt;<br>zweite Zeile<\/p><p>Neuer Absatz<\/p>/)
    assert.match(written, /<p>Antwort<\/p>/)
    assert.match(written, /Nora &lt;b&gt;/)
    assert.doesNotMatch(written, /<script>|<b>/)
  })

  it('stops when the theme has no texts in the language', async () => {
    await file('theme/templates/partials/comments.sort', TEMPLATE)
    await file('comments.json', '[]')
    await assert.rejects(
      renderComments({
        themePath: join(dir, 'theme'),
        commentsJsonPath: join(dir, 'comments.json'),
        commentsHtmlPath: join(dir, '_comments.html'),
        language: 'en',
      }),
      /i18n[\\/]en\.lima is missing/,
    )
  })
})

// review 2026-10-31 (before going public): the admin token went to any address, over http too
describe('the admin token', () => {
  it('goes over https, or to this machine', () => {
    assert.equal(carriesToken('https://comments.example'), true)
    assert.equal(carriesToken('http://127.0.0.1:9001'), true)
    assert.equal(carriesToken('http://localhost:9001'), true)
    assert.equal(carriesToken('http://[::1]:9001'), true)
    assert.equal(carriesToken('http://comments.example'), false)
    assert.equal(carriesToken('no address'), false)
  })
})
