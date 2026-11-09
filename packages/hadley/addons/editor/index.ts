// The block editor, an add-on of the dev server that loads it only for a site whose config.lima turns it on
// (docs/dev-server.md, "Block editor").
export { blockEditorPlugin, wroteItself } from './plugin.ts'
export { registerPageBlocks } from './renderer.ts'
export { startHistory } from './history.ts'
