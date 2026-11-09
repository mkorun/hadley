// The page brought up to date in place: its HTML from the server before a rebuild and after it, compared, and the
// difference applied to the live page (private/docs/SPEC_hadley-soft-reload.md). The two server versions are compared,
// not the live page, which scripts may have changed. In the content, the parent of the blocks: block by block, the
// ones alike keep their element and take their new id (a block's id carries the file's hash, so after a change every
// id is new); outside it, the smallest element that differs is replaced where it stands, as the reading time in a
// page's head. In the <head>, what shows nothing follows the text (its title, the description hadley takes from the
// text where the front matter gives none, JSON-LD); any other difference there or in the frame round the content, or
// a live page that does not match the HTML it came from, asks for a reload.

const ID = 'data-hadley-id'

export type Result = { kind: 'reload'; why: string } | { kind: 'done'; added: Element[]; changed: boolean }

/** An element as HTML, the block ids aside. */
function plain(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.removeAttribute(ID)
  for (const e of copy.querySelectorAll(`[${ID}]`)) e.removeAttribute(ID)
  return copy.outerHTML
}

/** The content: the parent of most blocks with an id. */
export function contentOf(doc: Document): Element | undefined {
  const count = new Map<Element, number>()
  for (const block of doc.querySelectorAll(`[${ID}]`)) {
    const parent = block.parentElement
    if (parent) count.set(parent, (count.get(parent) ?? 0) + 1)
  }
  let best: Element | undefined
  for (const [parent, n] of count) if (!best || n > count.get(best)!) best = parent
  return best
}

/** Where an element stands below <html>, as the indices of its ancestors' children. */
function pathOf(element: Element): number[] {
  const steps: number[] = []
  for (let e: Element | null = element; e?.parentElement; e = e.parentElement)
    steps.unshift([...e.parentElement.children].indexOf(e))
  return steps
}

function at(doc: Document, path: readonly number[]): Element | undefined {
  let e: Element | undefined = doc.documentElement
  for (const i of path) e = e?.children[i]
  return e
}

const attributes = (e: Element): string =>
  [...e.attributes]
    .filter((a) => a.name !== ID)
    .map((a) => `${a.name}=${a.value}`)
    .join('\n')

/** An element of the <head> that shows nothing on the page: its title, a meta, JSON-LD. */
const quiet = (e: Element): boolean =>
  e.tagName === 'TITLE' ||
  e.tagName === 'META' ||
  (e.tagName === 'SCRIPT' && e.getAttribute('type') === 'application/ld+json')

/** Same tag, same attributes (ids aside), as many children. */
const alike = (a: Element, b: Element): boolean =>
  a.tagName === b.tagName && a.children.length === b.children.length && attributes(a) === attributes(b)

/** The longest common subsequence of two lists, as steps: kept (old, new), out (old) or in (new). */
function steps(
  a: readonly string[],
  b: readonly string[],
): (['keep', number, number] | ['out', number] | ['in', number])[] {
  const n = a.length
  const m = b.length
  const w = m + 1
  const table = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * w + j] =
        a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!)
  const out: (['keep', number, number] | ['out', number] | ['in', number])[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) out.push(['keep', i++, j++])
    else if (i < n && (j === m || table[(i + 1) * w + j]! >= table[i * w + j + 1]!)) out.push(['out', i++])
    else out.push(['in', j++])
  }
  return out
}

/** Brings `live` from the server's `before` to its `after`, or says why only a reload can. */
export function swap(live: Document, before: Document, after: Document): Result {
  const oldRoot = contentOf(before)
  const newRoot = contentOf(after)
  if (!oldRoot || !newRoot) return { kind: 'reload', why: 'no content' }
  const path = pathOf(oldRoot)
  if (pathOf(newRoot).join('/') !== path.join('/')) return { kind: 'reload', why: 'the content moved' }
  // the head: element by element; only what shows nothing may differ, and is taken over
  const oldHead = [...before.head.children]
  const newHead = [...after.head.children]
  const liveHead = [...live.head.children]
  const headSwaps: [Element, Element][] = []
  if (oldHead.length !== newHead.length) return { kind: 'reload', why: 'the head differs' }
  for (const [i, element] of oldHead.entries()) {
    const next = newHead[i]!
    if (plain(element) === plain(next)) continue
    if (element.tagName !== next.tagName || !quiet(element)) return { kind: 'reload', why: 'the head differs' }
    const target = liveHead.find((e) => plain(e) === plain(element))
    if (!target) return { kind: 'reload', why: 'the live head differs' }
    headSwaps.push([target, next])
  }
  const liveRoot = at(live, path)
  if (!liveRoot || liveRoot.tagName !== oldRoot.tagName) return { kind: 'reload', why: 'no live content' }

  // outside the content: the smallest elements that differ; the content's ancestors must stay alike
  const outside: { path: number[]; element: Element }[] = []
  const walk = (a: Element, b: Element): boolean => {
    if (a === oldRoot || plain(a) === plain(b)) return true
    if (a.contains(oldRoot)) return alike(a, b) && [...a.children].every((child, i) => walk(child, b.children[i]!))
    const descend = alike(a, b) && [...a.children].some((child, i) => plain(child) !== plain(b.children[i]!))
    if (descend) return [...a.children].every((child, i) => walk(child, b.children[i]!))
    outside.push({ path: pathOf(a), element: b })
    return true
  }
  if (!walk(before.body, after.body)) return { kind: 'reload', why: 'the frame round the content differs' }
  const replace: [Element, Element][] = []
  for (const { path: where, element } of outside) {
    const target = at(live, where)
    if (!target || target.tagName !== element.tagName) return { kind: 'reload', why: 'the live page differs' }
    replace.push([target, element])
  }

  // the content, block by block; what the live page holds must be what the server sent
  const oldKids = [...oldRoot.children]
  const newKids = [...newRoot.children]
  // the field being saved stands in the content until the page shows its block anew (features/field.ts): not the
  // server's
  const liveKids = [...liveRoot.children].filter((kid) => !kid.classList.contains('hadley-editor'))
  if (liveKids.length !== oldKids.length || liveKids.some((kid, i) => kid.tagName !== oldKids[i]!.tagName))
    return { kind: 'reload', why: 'the live content differs' }

  const added: Element[] = []
  let changed = replace.length > 0
  let last: Element | null = null
  for (const step of steps(oldKids.map(plain), newKids.map(plain))) {
    if (step[0] === 'keep') {
      const kid = liveKids[step[1]]!
      const id = newKids[step[2]]!.getAttribute(ID)
      if (id === null) kid.removeAttribute(ID)
      else kid.setAttribute(ID, id)
      last = kid
    } else if (step[0] === 'in') {
      const node = live.importNode(newKids[step[1]]!, true)
      if (last) last.after(node)
      else liveRoot.prepend(node)
      added.push(node)
      last = node
      changed = true
    } else {
      liveKids[step[1]]!.remove()
      changed = true
    }
  }
  for (const [target, element] of replace) {
    const node = live.importNode(element, true)
    target.replaceWith(node)
    added.push(node)
  }
  for (const [target, element] of headSwaps) target.replaceWith(live.importNode(element, true))
  if (headSwaps.length > 0) changed = true
  // the ids outside the content (a page's head, docs/themes.md), in their order
  const outsideIds = (doc: Document, root: Element) =>
    [...doc.querySelectorAll(`[${ID}]`)].filter((e) => !root.contains(e))
  const liveIds = outsideIds(live, liveRoot)
  const newIds = outsideIds(after, newRoot)
  if (liveIds.length === newIds.length) liveIds.forEach((e, i) => e.setAttribute(ID, newIds[i]!.getAttribute(ID)!))
  return { kind: 'done', added, changed }
}
