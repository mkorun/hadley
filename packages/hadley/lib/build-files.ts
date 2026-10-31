/**
 * The files a page names, built: the files of its bundle its content and front matter name (copied, or images made in
 * lib/images.ts), and the site paths it links, checked against the plan (lib/output.ts).
 */
import sharp from 'sharp'
import type { Built, FileRequest } from '../case/index.ts'
import { readDestination } from '../case/index.ts'
import {
  copyInto,
  derivativeOwner,
  pictureBytes,
  pictureOf,
  processImage,
  resolveConfig,
  type AiLabels,
  type ImageCache,
  type ImageConfigs,
  type Place,
} from './images.ts'
import { findContentFile, type ContentFile } from './site-paths.ts'
import { urlOf } from './theme-files.ts'

/** What a browser runs as a page of the site, script and all: a page's bundle does not publish it (SECURITY.md). */
const BROWSER_DOCUMENT = /\.(?:html?|xhtml?|shtml|xml|mht|mhtml)$/i

/**
 * What was built for a page: its files by the node that names each, its first image (for the og:image), how many
 * images were made, and why a file could not be built (lib/problems.ts decides what becomes of that).
 */
/** What could not be built, and the node of the content or the front matter field that names it (lib/lines.ts). */
export type Failure = { message: string; node?: object; field?: string }

export type PageFiles = {
  files: Map<object, Built>
  firstImage?: ContentFile
  failures: Failure[]
  images: { built: number; cached: number } // the images it made, and those it took from the store
}

/**
 * Builds or copies every file of the bundle a page's content names (fileRequests): an image in the widths of its
 * config, a native-size image and every other file copied as it is. A file that cannot be found, built or copied is
 * `failed`, which the renderer shows, and one of the `failures`. It returns once every name is claimed, in the
 * order of the content, as the conflicts the plan finds name them (lib/output.ts); `written` is the files, once
 * they are written, so that a caller can claim the next page's names meanwhile.
 */
export const buildPageFiles = async (
  page: { file: string },
  refs: readonly FileRequest[],
  imageConfigs: ImageConfigs,
  // place claims a file of the page's output directory for what the page writes there (lib/output.ts)
  target: {
    place: (name: string, what: string) => string
    urlPath: string
    store: string // where derivatives are kept between builds
    base: string // what its files are named from: '' beside the page, its URL path for an error page (pageBase)
  },
  cache: ImageCache,
  aiLabels: AiLabels | undefined,
): Promise<{ written: Promise<PageFiles> }> => {
  const files = new Map<object, Built>()
  let firstImage: ContentFile | undefined
  // by request, in their order: why it failed
  const failures = refs.map((): Failure[] => [])
  // what is still being written, while the next file's names are claimed
  const writing: Promise<void>[] = []
  // an image the content names twice is made once
  const made = new Map<string, ReturnType<typeof processImage>>()
  for (const [i, ref] of refs.entries()) {
    const fail = (reason: string) => {
      failures[i]!.push({ message: `${ref.destination} ${reason}`, node: ref.node })
      files.set(ref.node, { kind: 'failed', reason: `${ref.destination} ${reason}` })
    }
    if (ref.kind === 'refused') {
      fail(ref.reason)
      continue
    }
    // a site path is checked once every page's files are claimed (sitePaths)
    if (ref.kind === 'path') continue
    const file = await findContentFile(page.file, ref.rel)
    if ('refused' in file) {
      fail(file.refused)
      continue
    }
    if (ref.kind === 'image' || ref.kind === 'native') firstImage ??= file
    // an image sharp cannot read is a file that could not be built, as a missing one is
    const couldNot = (error: unknown) =>
      fail(`could not be built: ${error instanceof Error ? error.message : String(error)}`)
    try {
      const building = await buildFile(ref, file, fail)
      if (building) writing.push(building.written.catch(couldNot))
    } catch (error) {
      couldNot(error)
    }
  }
  const written = Promise.all(writing).then(async (): Promise<PageFiles> => {
    const results = await Promise.all([...made.values()].map((result) => result.catch(() => undefined)))
    const images = {
      built: results.filter((result) => result && !result.fromCache).length,
      cached: results.filter((result) => result?.fromCache).length,
    }
    return { files, failures: failures.flat(), images, ...(firstImage ? { firstImage } : {}) }
  })
  return { written }

  async function buildFile(
    ref: Exclude<FileRequest, { kind: 'path' | 'refused' }>,
    file: ContentFile,
    fail: (reason: string) => void,
  ): Promise<{ written: Promise<void> } | undefined> {
    const labelled = (isAi: boolean) => (aiLabels && isAi ? aiLabels : undefined)

    if (ref.kind === 'copy' || ref.kind === 'native') {
      if (BROWSER_DOCUMENT.test(file.rel)) {
        fail('is a document a browser would run as a page, on the origin of the site (SECURITY.md)')
        return
      }
      const destFile = target.place(file.rel, file.rel)
      try {
        const meta = ref.kind === 'native' ? await sharp(await pictureBytes(file.source)).metadata() : undefined
        const ai = labelled(meta?.xmp !== undefined && /trainedAlgorithmicMedia/i.test(meta.xmp.toString('utf-8')))
        await copyInto(file.source, destFile)
        const href = `${target.base}${urlOf(file.rel)}${ref.suffix}`
        files.set(
          ref.node,
          meta
            ? {
                kind: 'native',
                href,
                ...(meta.width ? { width: meta.width } : {}),
                ...(meta.height ? { height: meta.height } : {}),
                ...(ai ? { ai } : {}),
              }
            : { kind: 'file', href },
        )
      } catch {
        fail('could not be copied')
      }
      return
    }

    const cfg = resolveConfig(imageConfigs, ref.config)
    if (!cfg) {
      fail('has no image config')
      return
    }
    const what = derivativeOwner(file.rel, cfg)
    const key = `${file.rel} ${JSON.stringify(cfg)}`
    if (!made.has(key))
      made.set(
        key,
        processImage(
          file.source,
          target.urlPath + file.rel,
          file.rel,
          (name) => target.place(name, what),
          cfg,
          cache,
          JSON.stringify(cfg),
          target.store,
        ),
      )
    const result = await made.get(key)!
    const ai = labelled(result.isAi)
    files.set(ref.node, {
      kind: 'picture',
      picture: pictureOf(file.rel, result, cfg, target.base),
      ...(ai ? { ai } : {}),
    })
    return { written: result.written }
  }
}

/**
 * What the site paths a page names (`path` requests) are, once the build claimed every page and every file of one
 * (lib/output.ts): a file under the name it is written under (`renamed`), a page (a path that ends in `/`) or any other
 * file the plan holds as a file, written as the content gives it. A path inside a directory a tool fills is none of
 * these. Anything else is `failed`, which the renderer shows, and one of the `failures`.
 */
export const sitePaths = (
  refs: readonly FileRequest[],
  writesFile: (rel: string) => boolean,
  renamed: ReadonlyMap<string, string>, // a file written under another name: a theme file, the syntax stylesheet
): { files: Map<object, Built>; failures: Failure[] } => {
  const files = new Map<object, Built>()
  const failures: Failure[] = []
  for (const ref of refs) {
    if (ref.kind !== 'path') continue
    const { path, suffix } = ref
    const name = renamed.get(path)
    let reason: string | undefined
    if (name !== undefined) files.set(ref.node, { kind: 'file', href: `/${urlOf(name)}${suffix}` })
    else if (writesFile(path === '' || path.endsWith('/') ? `${path}index.html` : path))
      files.set(ref.node, { kind: 'file', href: ref.href })
    else if (!path.endsWith('/') && writesFile(`${path}/index.html`)) reason = 'is a page, whose path ends in /'
    else reason = 'is neither a page nor a file the site writes'
    if (reason === undefined) continue
    failures.push({ message: `${ref.destination} ${reason}`, node: ref.node })
    files.set(ref.node, { kind: 'failed', reason: `${ref.destination} ${reason}` })
  }
  return { files, failures }
}

/**
 * The files a page's front matter names, read as content destinations are (readDestination in case/). Its
 * `cover` is a file of the bundle that must exist. Its `og:image` is an absolute http(s) URL (`ogImage`) or a file of
 * the bundle (`ogFile`), which buildPageFiles copies as it is, like any file the content names. The page goes
 * without a refused one, which is one of the `failures`.
 */
export const frontMatterFiles = async (
  page: { file: string; urlPath: string; metadata: Record<string, any> },
  origin: string, // the site's, on which an og:image is no URL of another site
): Promise<{
  cover?: ContentFile
  ogImage?: string
  ogFile?: { destination: string; rel: string; suffix: string }
  failures: Failure[]
}> => {
  const out: {
    cover?: ContentFile
    ogImage?: string
    ogFile?: { destination: string; rel: string; suffix: string }
    failures: Failure[]
  } = { failures: [] }
  const refuse = (message: string, field: string) => out.failures.push({ message, field })
  const { cover, 'og:image': ogImage } = page.metadata
  if (cover !== undefined) {
    const read = typeof cover === 'string' ? readDestination(cover, 'resource', page.urlPath, origin) : undefined
    const file =
      read?.kind === 'bundle' && read.suffix === ''
        ? await findContentFile(page.file, read.rel)
        : { refused: 'is not the name of a file of the bundle' }
    if ('refused' in file) refuse(`cover ${cover} ${file.refused}`, 'cover')
    else out.cover = file
  }
  if (ogImage !== undefined) {
    const read = typeof ogImage === 'string' ? readDestination(ogImage, 'resource', page.urlPath, origin) : undefined
    if (read?.kind === 'external') out.ogImage = ogImage
    else if (read?.kind === 'bundle') out.ogFile = { destination: ogImage, rel: read.rel, suffix: read.suffix }
    else refuse(`og:image ${ogImage} is neither an http(s) URL nor a file of the bundle`, 'og:image')
  }
  return out
}
