// merge.ts: puts an approved comment into the article's comments.json (into the tree of replies)

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

export interface PublicComment {
  id: string
  parent_comment_id: string | null
  name: string
  submitted_at: string
  text: string
  author_reply: boolean
  comments: PublicComment[]
}

function insertIntoTree(tree: PublicComment[], comment: PublicComment): boolean {
  for (const node of tree) {
    if (node.id === comment.parent_comment_id) {
      const idx = node.comments.findIndex((c) => c.submitted_at > comment.submitted_at)
      if (idx === -1) node.comments.push(comment)
      else node.comments.splice(idx, 0, comment)
      return true
    }
    if (insertIntoTree(node.comments, comment)) return true
  }
  return false
}

const holds = (tree: PublicComment[], id: string): boolean =>
  tree.some((comment) => comment.id === id || holds(comment.comments, id))

const find = (tree: PublicComment[], id: string): PublicComment | undefined => {
  for (const comment of tree) {
    const found = comment.id === id ? comment : find(comment.comments, id)
    if (found) return found
  }
  return undefined
}

/**
 * Puts `entry` into the comments.json at `commentsPath` and says so. Not added again: a comment whose id is there
 * already, approved in a run before, and an owner's reply whose text its comment holds from the owner already, under
 * any id (an older hadley gave a reply a random one).
 */
export async function mergeComment(
  commentsPath: string,
  entry: {
    id: string
    parent_comment_id: string | null
    name: string
    submitted_at: string
    text: string
    author_reply?: boolean
  },
): Promise<boolean> {
  let tree: PublicComment[] = []
  if (existsSync(commentsPath)) {
    const raw = await readFile(commentsPath, 'utf-8')
    tree = JSON.parse(raw)
  }
  if (holds(tree, entry.id)) return false
  if (entry.author_reply && entry.parent_comment_id !== null) {
    const replies = find(tree, entry.parent_comment_id)?.comments ?? []
    if (replies.some((reply) => reply.author_reply && reply.text === entry.text)) return false
  }

  const comment: PublicComment = {
    id: entry.id,
    parent_comment_id: entry.parent_comment_id,
    name: entry.name,
    submitted_at: entry.submitted_at,
    text: entry.text,
    author_reply: entry.author_reply ?? false,
    comments: [],
  }

  if (comment.parent_comment_id === null) {
    const idx = tree.findIndex((c) => c.submitted_at > comment.submitted_at)
    if (idx === -1) tree.push(comment)
    else tree.splice(idx, 0, comment)
  } else {
    const inserted = insertIntoTree(tree, comment)
    if (!inserted) {
      // no parent found: appended at the top level
      comment.parent_comment_id = null
      tree.push(comment)
    }
  }

  await mkdir(dirname(commentsPath), { recursive: true })
  await writeFile(commentsPath, JSON.stringify(tree, null, 2) + '\n')
  return true
}
