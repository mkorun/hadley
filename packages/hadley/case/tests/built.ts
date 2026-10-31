// What the case tests use in place of lib/build-files.ts: every bundle image is "built" as one 8-pixel webp, and a
// native-size one as 8×8, so the renderer can write it. `refs` is what fileRequests() named, without the nodes.
import { fileRequests, parseDocument, render, type Built, type CaseOptions, type Picture } from '../index.ts'
import { initHighlighter, prepareHighlighter } from '../highlighter.ts'

/** The Shiki theme `theme`, with Shiki loaded, for tests that render code they did not prepare. */
export async function highlighting(theme: string): Promise<void> {
  await initHighlighter(theme)
  await prepareHighlighter([parseDocument('```ts\nconst a = 1\n```\n', {})])
}

export const picture = (src: string): Picture => {
  const file = src.replace(/\.\w+$/, '-8w.webp')
  const sources = [{ type: 'image/webp', srcset: `${file} 8w` }]
  return { src: file, width: 8, height: 8, sizes: '100vw', sources }
}

/** The <picture> a figure holds for a bundle image `src` with `alt`, as the renderer writes it. */
export const pictureHtml = (src: string, alt: string): string => {
  const file = src.replace(/\.\w+$/, '-8w.webp')
  return (
    `<picture>\n  <source type="image/webp" srcset="${file} 8w" sizes="100vw">\n` +
    `  <img src="${file}" alt="${alt}" width="8" height="8" loading="lazy" decoding="async">\n</picture>`
  )
}

export function renderBuilt(source: string, caseOptions: CaseOptions & { bundlePath: string }) {
  // a page at the site's root, unless the test places it
  const options = { urlPath: '/', ...caseOptions }
  const doc = parseDocument(source, options)
  const refs = fileRequests(doc, options)
  const files = new Map<object, Built>()
  for (const ref of refs) {
    if (ref.kind === 'image') files.set(ref.node, { kind: 'picture', picture: picture(ref.destination) })
    if (ref.kind === 'native') files.set(ref.node, { kind: 'native', href: ref.destination, width: 8, height: 8 })
    if (ref.kind === 'copy') files.set(ref.node, { kind: 'file', href: ref.destination })
    if (ref.kind === 'path') files.set(ref.node, { kind: 'file', href: ref.href })
  }
  return {
    ...render(doc, { ...options, files }),
    refs: refs.map((ref): { kind: string; destination: string; config?: string; reason?: string } => ({
      kind: ref.kind,
      destination: ref.destination,
      ...(ref.kind === 'refused'
        ? { reason: ref.reason }
        : 'config' in ref && ref.config
          ? { config: ref.config }
          : {}),
    })),
  }
}
