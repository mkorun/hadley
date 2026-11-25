// How a theme writes comments: its comments template with the comments, their language and the theme's texts.
// `hadley comments` writes an article's _comments.html from it; a build with comments on renders it with sample
// comments, so that a template and texts that do not fit stop the build and not the moderation (docs/comments.md).
// A build loads this module, so it writes no file (scripts/check-writes.ts).

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import galley from '@mkorun/galley'
import { checked } from '../../lib/compile-templates.ts'
import { readLocales, type TemplateOptions } from '../../lib/site-config.ts'
import type { Locale } from '../../lib/site.ts'
import type { PublicComment } from './merge.ts'

/** A comment as the template gets it: with its text as paragraphs of lines, and its replies alike. */
export interface CommentView extends Omit<PublicComment, 'comments'> {
  paragraphs: string[][]
  comments: CommentView[]
}

// A comment's text as paragraphs of lines: the template writes each line escaped and sets <p> and <br> itself, so no
// HTML leaves this tool (AGENTS.md, Security)
const paragraphs = (text: string): string[][] => text.split(/\n{2,}/).map((para) => para.split('\n'))

const commentViews = (comments: PublicComment[]): CommentView[] =>
  comments.map((comment) => ({
    ...comment,
    paragraphs: paragraphs(comment.text),
    comments: commentViews(comment.comments),
  }))

// what the comment heading counts: the comments and their replies
const countAll = (comments: CommentView[]): number =>
  comments.reduce((count, comment) => count + 1 + countAll(comment.comments), 0)

/**
 * The comments template of a theme, compiled: `render` gives what it writes for comments in a language, with
 * `comments`, `count` (of the comments and their replies), `language` and the theme's texts `t`.
 */
export interface CommentsTemplate {
  path: string
  // texts: the theme's texts in that language (t.*), as a build has them (lib/site-config.ts, readLocales)
  render: (comments: CommentView[], language: string, texts: Locale) => Promise<string>
}

/**
 * Compiles the comments template of the theme in `themeDir` (templates/comments.sort, else
 * templates/partials/comments.sort) with the site's template options. It and every partial it includes are read as
 * the templates of a build are, which refuses a {@raw} of what a visitor wrote (AGENTS.md, Security).
 */
export async function compileComments(themeDir: string, options: TemplateOptions): Promise<CommentsTemplate> {
  const templatesDir = join(themeDir, 'templates')
  const candidates = [join(templatesDir, 'comments.sort'), join(templatesDir, 'partials', 'comments.sort')]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (!path) throw new Error(`the theme has no comments template: ${candidates.join(', or ')}`)
  const galleyOptions = checked({
    ...options,
    includes: { import: (file, enc) => readFile(file, enc as BufferEncoding), basedir: templatesDir },
  })
  const source = await galleyOptions.includes.import(path, 'utf-8')
  // named, so that galley's errors name the file
  const template = await galley(source, { ...galleyOptions, sourceId: path })
  return {
    path,
    render: async (comments, language, texts) =>
      template.render({ comments, count: countAll(comments), language, t: texts }),
  }
}

/**
 * What the theme writes for an article's comments.json, its _comments.html: in the article's language and with the
 * texts a build of the site has for that language.
 */
export async function renderComments(opts: {
  siteDir: string
  defaultLanguage: string
  commentsJsonPath: string
  language: string
  templateOptions: TemplateOptions
}): Promise<string> {
  const { siteDir, language } = opts
  const tree: PublicComment[] = JSON.parse(await readFile(opts.commentsJsonPath, 'utf-8'))
  const template = await compileComments(join(siteDir, 'theme'), opts.templateOptions)
  const locales = await readLocales(siteDir, [language], opts.defaultLanguage)
  return template.render(commentViews(tree), language, locales[language] ?? {})
}

/**
 * `count` comments for the check, as an article has them: the first, the third and so on have two paragraphs, a
 * second line and the owner's reply below; those between are one line without a reply.
 */
export function sampleComments(count: number): CommentView[] {
  const comment = (id: string, text: string, comments: PublicComment[] = []): PublicComment => ({
    id,
    parent_comment_id: null,
    name: 'Sample',
    submitted_at: '2026-01-01T12:00:00Z',
    text,
    author_reply: false,
    comments,
  })
  return commentViews(
    Array.from({ length: count }, (_, index) => {
      const id = `sample-${index + 1}`
      if (index % 2 === 1) return comment(id, 'One line.')
      const reply = { ...comment(`${id}-reply`, 'A reply.'), parent_comment_id: id, author_reply: true }
      return comment(id, 'A first line\nand a second.\n\nA second paragraph.', [reply])
    }),
  )
}

/**
 * The counts of comments the check renders in `language`: none, one and two, and the smallest count from 3 to 100
 * that selects each plural category which one and two do not. So a loop meets a second comment in every language,
 * also in one with a single category (Japanese), and a form that only a count from 3 selects is asked for (`many` in
 * Polish, at 5). The category of none does not count as selected: a template may write no heading for no comments. A
 * category that only a count above 100 selects (`many` in French, at a million) is not checked.
 */
export function sampleCounts(language: string): number[] {
  const counts = [0, 1, 2]
  const rules = pluralRules(language)
  // without rules a language has no categories, and a template that asks for one fails at any count (galley, plural)
  if (!rules) return counts
  const selected = new Set([rules.select(1), rules.select(2)])
  for (let count = 3; count <= 100; count++) {
    const category = rules.select(count)
    if (selected.has(category)) continue
    selected.add(category)
    counts.push(count)
  }
  return counts
}

/** The plural rules the runtime has for `language` itself; none for another language's, or a name that is no tag. */
function pluralRules(language: string): Intl.PluralRules | undefined {
  try {
    return Intl.PluralRules.supportedLocalesOf(language).length > 0 ? new Intl.PluralRules(language) : undefined
  } catch {
    return undefined
  }
}

/**
 * The check of a build with comments on: the comments template compiles as `hadley comments` compiles it and writes
 * the sample comments in each of `languages`, with the texts the build has for it (`locales`), in each of
 * sampleCounts, first without their replies and then with them. Without, `count` is the number of comments, so a
 * heading that counts the replies and one that does not (a theme copied before `count`) both meet every count. A
 * failure names the template, the comments, the language and what galley said.
 */
export async function checkComments(
  themeDir: string,
  options: TemplateOptions,
  locales: Record<string, Locale>,
  languages: readonly string[],
): Promise<void> {
  const template = await compileComments(themeDir, options)
  for (const language of languages) {
    for (const count of sampleCounts(language)) {
      const withReplies = sampleComments(count)
      const withoutReplies = withReplies.map((comment) => ({ ...comment, comments: [] }))
      for (const [comments, which] of [
        [withoutReplies, `${count} comment(s) without replies`],
        [withReplies, `${count} comment(s) with the owner's replies`],
      ] as const)
        await template.render(comments, language, locales[language] ?? {}).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`${template.path}: ${which} in ${language} cannot be written: ${reason}`, { cause: error })
        })
    }
  }
}
