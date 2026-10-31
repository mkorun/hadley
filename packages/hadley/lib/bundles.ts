/**
 * The Markdown files of a site's content, found by its folders: content/<root>/ holds bundles (`[id]/`), collections
 * of them (`@name/[id]/`) and error pages (`@errors/[id]/`); a bundle holds its page in the default language
 * (`id.md`), its variants (`_name.md`) and its other languages (`en/id.md`). Notes may also stand alone as `.md` files.
 * A file whose name is all capitals (`README.md`, `NOTES.md`) is no page.
 */
import { readdir } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import { isSystemFile } from './platform.ts'

/** The content roots, each with the type its pages have unless their front matter says otherwise. */
export const CONTENT_ROOTS = ['articles', 'essays', 'notes', 'pages'] as const

/** A Markdown file that is a page. */
export interface PageFile {
  file: string
  bundleDir: string // the [id]/ directory, or the directory a solitary note lies in
  bundleId: string
  collectionId: string | null // @name, or 'errors'
  language: string
  variant: string | null // _name.md
  /** a page of another repository (lib/sources.ts): its source, and the fields config.lima gives it */
  fromSource?: { name: string; fields: Record<string, unknown>; problems: string[] }
}

/** Returns true if a file stem is a solitary note (not UPPERCASE-only, no _ prefix). */
export const _isSolitaire = (stem: string): boolean =>
  !(/[a-zA-Z]/.test(stem) && stem === stem.toUpperCase()) && !stem.startsWith('_')

const allCapitals = (stem: string) => /[a-zA-Z]/.test(stem) && stem === stem.toUpperCase()
const bundleIdOf = (name: string): string | null => /^\[(.+)\]$/.exec(name)?.[1] ?? null

/**
 * The entries of `dir` but the files an operating system leaves, in the order of their names, by code point: the
 * same on every file system and runtime.
 */
const entriesOf = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => !isSystemFile(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

type Bundle = { bundleDir: string; bundleId: string; collectionId: string | null; solitary?: string }

/**
 * The pages of content/<root>/ in `contentDir`, folder by folder in the order of their names; none if the root is
 * missing.
 */
export async function pageFiles(contentDir: string, root: string, defaultLanguage: string): Promise<PageFile[]> {
  const rootDir = joinPath(contentDir, root)
  const entries = await entriesOf(rootDir).catch(() => undefined)
  if (!entries) return []
  const notes = root === 'notes'
  const bundles: Bundle[] = []
  // a directory's bundles, and for notes its solitary notes
  const collect = async (dir: string, names: typeof entries, collectionId: string | null) => {
    for (const entry of names) {
      const stem = entry.name.slice(0, -'.md'.length)
      if (notes && entry.isFile() && entry.name.endsWith('.md')) {
        if (_isSolitaire(stem))
          bundles.push({ bundleDir: dir, bundleId: stem, collectionId, solitary: joinPath(dir, entry.name) })
        continue
      }
      if (!entry.isDirectory()) continue
      const id = bundleIdOf(entry.name)
      if (id) bundles.push({ bundleDir: joinPath(dir, entry.name), bundleId: id, collectionId })
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === '@errors') {
      const dir = joinPath(rootDir, entry.name)
      const inner = (await entriesOf(dir)).filter((e) => e.isDirectory())
      await collect(dir, inner, 'errors')
    } else if (entry.isDirectory() && entry.name.startsWith('@')) {
      const dir = joinPath(rootDir, entry.name)
      await collect(dir, await entriesOf(dir), entry.name.slice(1))
    } else {
      await collect(rootDir, [entry], null)
    }
  }

  const files: PageFile[] = []
  for (const bundle of bundles) {
    const { bundleDir, bundleId, collectionId } = bundle
    const add = (file: string, name: string, language: string) => {
      const variant = name.startsWith('_') ? name.slice(1, -'.md'.length) : null
      files.push({ file, bundleDir, bundleId, collectionId, language, variant })
    }
    if (bundle.solitary) {
      files.push({ file: bundle.solitary, bundleDir, bundleId, collectionId, language: defaultLanguage, variant: null })
      continue
    }
    for (const entry of await entriesOf(bundleDir)) {
      const isPage = (name: string) => name.endsWith('.md') && !allCapitals(name.slice(0, -'.md'.length))
      if (entry.isFile() && isPage(entry.name)) add(joinPath(bundleDir, entry.name), entry.name, defaultLanguage)
      else if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('@')) {
        // a language directory
        const langDir = joinPath(bundleDir, entry.name)
        for (const inner of await entriesOf(langDir)) {
          if (inner.isFile() && isPage(inner.name)) add(joinPath(langDir, inner.name), inner.name, entry.name)
        }
      }
    }
  }
  return files
}
