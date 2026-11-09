// The block editor, an add-on of the dev server that loads it only for a site whose config.lima turns it on
// (docs/dev-server.md, "Block editor").
export { blockEditorPlugin } from './plugin.ts'
export { wroteItself } from './upload.ts'
export { registerPageBlocks } from './renderer.ts'
export { startHistory } from './history.ts'
