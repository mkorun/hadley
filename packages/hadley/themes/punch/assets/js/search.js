// punch: the search (config.lima search.enabled) in a dialog, on Pagefind's search API: Pagefind finds, the theme
// shows. Pagefind's script and index load the first time the dialog opens, so a page nobody searches on loads neither.
// The results are those of the page's language (data-pagefind-filter on main): the index holds every language.
const dialog = document.querySelector('dialog.search')
const button = document.querySelector('.search-open')
// how many results the list shows
const SHOWN = 8

const element = (tag, className, text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Pagefind's excerpt is text with <mark> around what it found: kept as text and marks, and nothing else
const excerpt = (html) => {
  const template = document.createElement('template')
  template.innerHTML = html
  const span = element('span', 'search-excerpt')
  for (const node of template.content.childNodes)
    span.append(node.nodeName === 'MARK' ? element('mark', '', node.textContent) : node.textContent)
  return span
}

// Pagefind's excerpt often begins with the page's title, which the result shows above it: left out there
const withoutTitle = (span, title) => {
  const text = span.textContent
  if (!title || !text.startsWith(title)) return span
  let drop = title.length + (text.slice(title.length).match(/^[.:]?\s*/)?.[0].length ?? 0)
  for (const node of [...span.childNodes]) {
    if (drop <= 0) break
    const length = node.textContent.length
    if (length <= drop) node.remove()
    else node.textContent = node.textContent.slice(drop)
    drop -= length
  }
  return span
}

const entry = (result, index) => {
  const item = element('li', 'search-result')
  item.id = `search-result-${index}`
  item.setAttribute('role', 'option')
  // an option holds no link, which would be a control inside a control: the list follows it (follow, below)
  const link = document.createElement('a')
  link.dataset.url = result.url
  const meta = [result.meta.category, result.meta.date?.slice(0, 10)].filter(Boolean).join(' · ')
  const text = element('span', 'search-text')
  if (meta) text.append(element('span', 'search-meta', meta))
  text.append(
    element('span', 'search-title', result.meta.title ?? result.url),
    withoutTitle(excerpt(result.excerpt), result.meta.title),
  )
  if (result.meta.image) {
    const image = element('img', 'search-image')
    // Pagefind keeps the path as the page writes it, relative to that page
    image.src = new URL(result.meta.image, new URL(result.url, location.href)).href
    image.alt = ''
    image.loading = 'lazy'
    link.append(image)
  } else {
    // a page without a picture: a small sheet in its place
    const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    sheet.setAttribute('viewBox', '0 0 24 24')
    sheet.setAttribute('aria-hidden', 'true')
    sheet.innerHTML =
      '<path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M10 11h5M10 14h5M10 17h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    const box = element('span', 'search-image')
    box.append(sheet)
    link.append(box)
  }
  link.append(text)
  item.append(link)
  return item
}

if (dialog && button) {
  const input = dialog.querySelector('.search-input')
  const status = dialog.querySelector('.search-status')
  const list = dialog.querySelector('.search-results')
  const lang = document.documentElement.lang
  let pagefind
  let asked = 0
  let active = -1

  const load = () =>
    (pagefind ??= import('/pagefind/pagefind.js').then(async (module) => {
      await module.init()
      return module
    }))

  const follow = (item, newTab) => {
    const url = item?.querySelector('a')?.dataset.url
    if (!url) return
    if (newTab) window.open(url, '_blank', 'noopener')
    else location.assign(url)
  }

  const select = (index) => {
    active = index
    for (const [i, item] of [...list.children].entries()) item.setAttribute('aria-selected', String(i === active))
    list.children[active]?.scrollIntoView({ block: 'nearest' })
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-result-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }

  const search = async () => {
    const term = input.value.trim()
    const ask = ++asked
    if (!term) {
      list.replaceChildren()
      status.textContent = ''
      input.setAttribute('aria-expanded', 'false')
      return select(-1)
    }
    const found = await (await load()).debouncedSearch(term, { filters: { lang } }, 150)
    // null: a later keystroke asked again
    if (found === null || ask !== asked) return
    const results = await Promise.all(found.results.slice(0, SHOWN).map((result) => result.data()))
    if (ask !== asked) return
    list.replaceChildren(...results.map(entry))
    input.setAttribute('aria-expanded', String(results.length > 0))
    status.textContent = (results.length ? dialog.dataset.results : dialog.dataset.none)
      .replace('{count}', String(found.results.length))
      .replace('{term}', term)
    select(results.length ? 0 : -1)
  }

  const open = () => {
    dialog.showModal()
    input.select()
    load()
  }

  button.hidden = false
  button.addEventListener('click', open)
  input.addEventListener('input', () => void search())
  input.addEventListener('keydown', (event) => {
    const count = list.children.length
    if (event.key === 'ArrowDown' && count > 0) select((active + 1) % count)
    else if (event.key === 'ArrowUp' && count > 0) select((active - 1 + count) % count)
    else if (event.key === 'Enter') follow(list.children[active], event.ctrlKey || event.metaKey)
    // closes at once: a search field would empty itself first
    else if (event.key === 'Escape') dialog.close()
    else return
    event.preventDefault()
  })
  // a click opens the result, in a new tab with Ctrl or ⌘ or the middle button, as a link would
  list.addEventListener('click', (event) =>
    follow(event.target.closest('.search-result'), event.ctrlKey || event.metaKey),
  )
  list.addEventListener('auxclick', (event) => {
    if (event.button === 1) follow(event.target.closest('.search-result'), true)
  })
  list.addEventListener('mousemove', (event) => {
    const item = event.target.closest('.search-result')
    if (item) select([...list.children].indexOf(item))
  })
  // a click on the backdrop closes it
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault()
      if (dialog.open) dialog.close()
      else open()
    }
  })
}
