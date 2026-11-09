/**
 * The block editor in the browser, a core and its features. Its stylesheet stands before it in the page's head, the
 * chat's script after it (lib/dev-server.ts): a module script runs once the stylesheets before it are loaded, and the
 * module scripts in their order, so the chat finds the editor's bar. So nothing here waits before the editor stands.
 *
 * A feature knows the core only; what one does for another is wired here, in the open. A new feature is a module of
 * features/, its lines here, and its CSS file in STYLES (../browser-files.ts).
 */
import { state } from './core/state.ts'
import { LANG } from './core/texts.ts'
import { actions } from './features/actions.ts'
import { bar } from './features/bar.ts'
import { confirmDelete } from './features/dialog.ts'
import { field } from './features/field.ts'
import { bundleFiles } from './features/files.ts'
import { frames } from './features/frames.ts'
import { limaTable } from './features/front-matter.ts'
import { attachHeads } from './features/heads.ts'
import { menu } from './features/menu.ts'
import { acceptPictures } from './features/pictures.ts'

document.documentElement.dataset['hadleyLang'] = LANG

const theFrames = frames()
const theBar = bar({
  leave() {
    theField.close()
    theMenu.close()
  },
  changed: () => theFrames.queue(),
})
const theActions = actions({
  closeMenu: () => theMenu.close(),
  lock() {
    state.locked = true
    theMenu.close()
    theBar.reloading()
  },
  confirm: confirmDelete,
})
const theMenu = menu({
  add(block) {
    void theField.open(block.dataset['hadleyId']!, block, { below: true })
  },
  edit(block) {
    void theField.open(block.dataset['hadleyId']!, block)
  },
  merge: (block, direction) => void theActions.merge(block, direction),
  move: (block, direction) => void theActions.move(block, direction),
  remove: (block) => void theActions.remove(block),
})
const theField = field({
  closeMenu: () => theMenu.close(),
  table: limaTable,
  files: (blockId, textarea, toolbar) => void bundleFiles(blockId, textarea, toolbar),
  pictures: (blockId, textarea, toolbar) => acceptPictures(blockId, textarea, toolbar, bundleFiles),
})

// Escape: the field before the menu (the order matters)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.block) {
    theField.close()
    return
  } // field open → close it (whichever element has focus)
  if (theMenu.isOpen()) theMenu.close() // only the menu open → close it
})

theBar.draw()
theMenu.attach()
void attachHeads({
  edit: (blockId, element, options) => void theField.open(blockId, element, options),
  badge: (badge) => theFrames.badge(badge),
}).then(() => theFrames.queue())
theFrames.start()
