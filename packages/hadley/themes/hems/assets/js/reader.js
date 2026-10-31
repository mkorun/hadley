// hems: what the reader chose, kept in the browser: light or dark (theme.colorToggle) and the language.
// It runs in <head>, before the page is drawn, so a page never shows the other scheme or language first.
const SCHEME = 'hems-color-scheme'
const LANGUAGE = 'hems-language'
const root = document.documentElement

const stored = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

// the language the reader chose: this page in it, where the page has it (its <link rel="alternate" hreflang>, whose
// path is taken, so that a local build stays local)
const language = stored(LANGUAGE)
if (language && language !== root.lang) {
  const version = document.querySelector(`link[rel="alternate"][hreflang="${CSS.escape(language)}"]`)
  if (version) location.replace(new URL(version.href).pathname)
}

// light or dark: the reader's choice, else the site's (theme.colorScheme, data-color-scheme) or the system's
const site = root.dataset.colorScheme ?? 'auto'
const system = matchMedia('(prefers-color-scheme: dark)')
const choice = () => {
  const chosen = stored(SCHEME)
  return chosen === 'light' || chosen === 'dark' ? chosen : 'auto'
}
const apply = (chosen) => {
  const scheme = chosen === 'auto' ? site : chosen
  if (scheme === 'auto') delete root.dataset.colorScheme
  else root.dataset.colorScheme = scheme
  root.dataset.colorChoice = chosen
}
apply(choice())

document.addEventListener('DOMContentLoaded', () => {
  for (const link of document.querySelectorAll('.languages a[hreflang]'))
    link.addEventListener('click', () => store(LANGUAGE, link.hreflang))

  const button = document.querySelector('.scheme')
  if (!button) return
  button.hidden = false
  button.addEventListener('click', () => {
    // auto → the other of what auto shows → what auto shows → auto
    const shown = site !== 'auto' ? site : system.matches ? 'dark' : 'light'
    const other = shown === 'dark' ? 'light' : 'dark'
    const next = { auto: other, [other]: shown, [shown]: 'auto' }[choice()]
    store(SCHEME, next === 'auto' ? null : next)
    apply(next)
  })
})
