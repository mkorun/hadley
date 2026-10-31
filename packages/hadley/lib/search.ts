import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join as joinPath, resolve } from 'node:path'

// forceLanguage: 'en' works around Pagefind bug #724: its German language module takes umlauts for word breaks
// ("zündung" becomes "zu" and "ndung").
const OPTIONS = { forceLanguage: 'en' }

/**
 * Indexes the pages the build lists (`searchable`, paths in `outputDir`), not every HTML file there, into
 * `outputDir/pagefind`, which it empties first: a dev build keeps its output, and an index of an earlier build would
 * leave its fragments there. `cacheDir` keeps the last index with its key, the pages and the Pagefind version: the
 * index of the same pages is copied from there.
 */
export async function runPagefind(outputDir: string, searchable: string[], cacheDir: string): Promise<void> {
  const target = joinPath(outputDir, 'pagefind')
  await rm(target, { recursive: true, force: true })
  // sorted, so that the index does not depend on the order the build met the pages in
  const pages: [string, string][] = []
  for (const sourcePath of [...searchable].sort())
    pages.push([sourcePath, await readFile(joinPath(outputDir, sourcePath), 'utf-8')])
  const pagefind = new URL('../package.json', import.meta.resolve('pagefind'))
  const { version } = JSON.parse(await readFile(pagefind, 'utf-8'))
  const key = createHash('sha256')
    .update(JSON.stringify([version, OPTIONS, pages]))
    .digest('hex')
  const cached = joinPath(cacheDir, 'pagefind')
  if ((await readFile(joinPath(cacheDir, 'key'), 'utf-8').catch(() => '')) === key) {
    await cp(cached, target, { recursive: true })
    return
  }

  const { createIndex } = await import('pagefind')
  const { index, errors } = await createIndex(OPTIONS)
  if (!index) throw new Error(`Pagefind createIndex failed: ${errors.join(', ')}`)
  // released again when written: the Pagefind service keeps every index it made, and a dev server builds many
  try {
    for (const [sourcePath, content] of pages) {
      const { errors: fileErrors } = await index.addHTMLFile({ sourcePath, content })
      if (fileErrors.length) throw new Error(`Pagefind addHTMLFile ${sourcePath} failed: ${fileErrors.join(', ')}`)
    }
    // absolute: the Pagefind service resolves a relative path against the directory it started in, the first build's
    const { errors: writeErrors } = await index.writeFiles({ outputPath: resolve(target) })
    if (writeErrors.length) throw new Error(`Pagefind writeFiles failed: ${writeErrors.join(', ')}`)
  } finally {
    await index.deleteIndex()
  }
  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })
  await cp(target, cached, { recursive: true })
  await writeFile(joinPath(cacheDir, 'key'), key)
}
