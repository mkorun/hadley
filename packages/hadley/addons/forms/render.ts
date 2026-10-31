// render.ts — comments.sort → _comments.html via galley

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as limaparse } from '@limaformat/lima'
import type { PublicComment } from './merge.ts'

// A comment's text as paragraphs of lines: the template writes each line escaped and sets <p> and <br> itself, so no
// HTML leaves this tool (AGENTS.md, Security)
const paragraphs = (text: string): string[][] => text.split(/\n{2,}/).map((para) => para.split('\n'))

function withParagraphs(comments: PublicComment[]): (PublicComment & { paragraphs: string[][] })[] {
  return comments.map((c) => ({
    ...c,
    paragraphs: paragraphs(c.text),
    comments: withParagraphs(c.comments) as any,
  }))
}

// the theme's texts in the article's language (t.*), as the build reads them
async function themeTexts(themePath: string, language: string): Promise<unknown> {
  const path = join(themePath, 'i18n', `${language}.lima`)
  const text = await readFile(path, 'utf-8').catch(() => {
    throw new Error(`${path} is missing: the theme's texts in this language`)
  })
  return limaparse(text)
}

async function findTemplate(themePath: string): Promise<string> {
  const candidates = [`${themePath}/templates/comments.sort`, `${themePath}/templates/partials/comments.sort`]
  for (const p of candidates) {
    if (existsSync(p)) return await readFile(p, 'utf-8')
  }
  throw new Error(`comments.sort not found; expected in:\n  ${candidates.join('\n  ')}`)
}

export async function renderComments(opts: {
  themePath: string
  commentsJsonPath: string
  commentsHtmlPath: string
  language: string
}): Promise<void> {
  const { themePath, commentsJsonPath, commentsHtmlPath, language } = opts

  let tree: PublicComment[] = []
  if (existsSync(commentsJsonPath)) {
    const raw = await readFile(commentsJsonPath, 'utf-8')
    tree = JSON.parse(raw)
  }

  const src = await findTemplate(themePath)
  const { default: galley } = await import('@mkorun/galley')
  const { default: util } = await import('@mkorun/galley/util')

  const tpl = await galley(src, {
    includes: {
      import: (path, enc) => readFile(path, enc as BufferEncoding),
      basedir: `${themePath}/templates`,
    },
  })
  const html = await Promise.resolve(
    tpl.render({ comments: withParagraphs(tree), language, t: await themeTexts(themePath, language) }, util),
  )

  await mkdir(dirname(commentsHtmlPath), { recursive: true })
  await writeFile(commentsHtmlPath, html)
}
