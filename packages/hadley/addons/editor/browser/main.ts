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
import { confirmRestore } from './features/dialog.ts'
import { field } from './features/field.ts'
import { bundleFiles } from './features/files.ts'
import { frames } from './features/frames.ts'
import { limaTable } from './features/front-matter.ts'
import { heads } from './features/heads.ts'
import { holdLinks } from './features/links.ts'
import { menu } from './features/menu.ts'
import { acceptPictures } from './features/pictures.ts'
import { undo } from './features/undo.ts'
import { updating } from './features/updating.ts'
import { versions } from './features/versions/index.ts'

document.documentElement.dataset['hadleyLang'] = LANG

const theFrames = frames()
const theBar = bar({
  leave() {
    theField.close()
    theMenu.close()
    theVersions.close()
  },
  changed: () => theFrames.queue(),
})
// after a change the page is brought up to date in place (refresh/); the editor waits for it, locked
const theUpdating = updating({
  lock() {
    state.locked = true
    theMenu.close()
    theBar.updating()
  },
  unlock() {
    state.locked = false
    theBar.ready()
  },
  note: (text) => theBar.note(text),
  refreshed() {
    theMenu.attach()
    void theHeads.refresh().then(() => theFrames.queue())
    theVersions.refreshed()
    void theUndo.refresh()
  },
})
const theActions = actions({
  closeMenu: () => theMenu.close(),
  lock(what) {
    theUndo.offer(what)
    theUpdating.wait()
  },
})
// the animations' styles go in the same task as the page changes, so that nothing between is painted
document.addEventListener('hadley:swapping', () => theActions.settle())
const theMenu = menu({
  add(block) {
    void theField.open(block.dataset['hadleyId']!, block, { below: true })
  },
  edit(block, word) {
    void theField.open(block.dataset['hadleyId']!, block, { word })
  },
  merge: (block, direction) => void theActions.merge(block, direction),
  move: (block, direction) => void theActions.move(block, direction),
  remove: (block) => void theActions.remove(block),
})
const theField = field({
  closeMenu: () => theMenu.close(),
  saved: (block) => theUpdating.wait(block),
  table: limaTable,
  files: (blockId, textarea, tools) => void bundleFiles(blockId, textarea, tools),
  pictures: (blockId, textarea, toolbar, tools) =>
    acceptPictures(blockId, textarea, toolbar, (id, field) => bundleFiles(id, field, tools)),
})

// Escape: the field before the menu (the order matters)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.block) {
    theField.cancel()
    return
  } // field open → close it, after a question where it changed (whichever element has focus)
  if (theMenu.isOpen()) theMenu.close() // only the menu open → close it
})

// the time machine: its button in the pill, its card above it; restoring holds the editor as a change does
const theVersions = versions({
  add: (control) => theBar.add(control),
  place: (card) => theBar.place(card),
  confirm: confirmRestore,
  lock: () => theUpdating.wait(),
})

theBar.draw()
theMenu.attach()
holdLinks()
// undo and redo in the pill, after the versions' button; a step is a change as any
const theUndo = undo({
  add: (control) => theBar.add(control),
  note: (text, action) => theBar.note(text, action),
  wait: () => theUpdating.wait(),
})
void theUndo.refresh()

const theHeads = heads({
  edit: (blockId, element, options) => void theField.open(blockId, element, options),
  badge: (badge) => theFrames.badge(badge),
})
void theHeads.refresh().then(() => theFrames.queue())
theFrames.start()
