/**
 * The block editor in the browser, being rebuilt from assets/editor.js as a core and its features. `hadley dev` loads
 * it in place of the old one only under HADLEY_EDITOR=next (docs/dev-server.md), until it does all the old one does.
 * It loads its stylesheet first, then builds the editor, and only then the chat, which looks for the editor's bar.
 * A new feature is a module of features/, one line here, and its CSS file in STYLES (../browser-files.ts).
 */

const stylesheet = (href: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.addEventListener('load', () => resolve())
    link.addEventListener('error', () => reject(new Error(`the editor's stylesheet did not load: ${href}`)))
    document.head.append(link)
  })

await stylesheet('/__hadley/editor/editor.css')

// the chat, where config.lima turns it on: dev-server.ts names its module on the script that loads this one
const chat = document.querySelector<HTMLScriptElement>('script[data-hadley-chat]')?.dataset['hadleyChat']
if (chat) await import(chat)
