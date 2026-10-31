/**
 * What a template sees of its language as `site`: the language's values and, as `site.pages`, its listed pages alone
 * (lib/site.ts, PageOutputs.listed). A template that asks for any other page stops the build, so a draft, a note, an
 * archived or a mistyped page never shows up as an empty link.
 */
import type { Language, Page } from './site.ts'

export type SiteView = Omit<Language, 'pages' | 'listed'> & { pages: Readonly<Record<string, Page>> }

export function siteView(language: Language, name: string): SiteView {
  const { pages: _all, listed, ...values } = language
  const pages = new Proxy(listed, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !Object.hasOwn(target, key))
        throw new Error(`site.pages has no listed page ${JSON.stringify(key)} in the language ${name}`)
      return Reflect.get(target, key, receiver)
    },
  })
  return { ...values, pages }
}
