// What a version of a page changed, as the editor says it: who made it and what it did (the versions card, undo and
// redo). A version as the time machine's routes send it (addons/editor/history.ts).
import { T } from './texts.ts'

export interface Change {
  at: number
  by: 'editor' | 'agent' | 'outside' | 'restore'
  what?: 'edit' | 'move' | 'merge' | 'delete' | 'new' | 'picture'
  agent?: string
}

export const WHAT: Record<NonNullable<Change['what']>, string> = {
  edit: T.whatEdit,
  move: T.whatMove,
  merge: T.whatMerge,
  delete: T.whatDelete,
  new: T.whatNew,
  picture: T.whatPicture,
}

const WHO: Record<Exclude<Change['by'], 'agent'>, string> = {
  editor: T.byEditor,
  outside: T.byOutside,
  restore: T.byRestore,
}

/** Who made a change and what it did: "Editor · Block edited", "while Claude Code was working". */
export const described = (change: Change): string =>
  [
    change.by === 'agent' ? T.byAgent.replace('{agent}', change.agent ?? 'AI') : WHO[change.by],
    change.what ? WHAT[change.what] : '',
  ]
    .filter(Boolean)
    .join(' · ')
