// The editor is the author's tool, not part of the page: it speaks the first of the browser's languages it knows
// (navigator.languages), else English, whatever the page's own language; the language switch in the control at the
// bottom right overrides it for the site, kept in localStorage. Server-side error messages (plugin.ts) have their own
// mirrored table (i18n.ts); withLang() appends the same language as a query parameter. The chat (addons/chat) reads it
// from the root element's data-hadley-lang.

export const LANGS = ['de', 'en'] as const
// each language as it names itself, in the editor's language menu (features/bar.ts)
export const LANG_NAMES: Record<(typeof LANGS)[number], string> = { de: 'Deutsch', en: 'English' }
export type Lang = (typeof LANGS)[number]
export const LANG_KEY = 'hadley-lang'

const known = (tag: string | null): tag is Lang => (LANGS as readonly (string | null)[]).includes(tag)

function chooseLang(): Lang {
  try {
    const chosen = localStorage.getItem(LANG_KEY)
    if (known(chosen)) return chosen
  } catch {
    // without storage the browser's languages decide
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).toLowerCase().split('-')[0] ?? ''
    if (known(base)) return base
  }
  return 'en'
}

export const LANG = chooseLang()

const de = {
  editLabel: 'Bearbeiten',
  limaUnavailable: 'Lima ließ sich nicht laden: Keys und Fehler zeigt erst das Speichern',
  langMenu: 'Sprache des Editors',
  langSwitchBusy: 'Erst den offenen Block speichern oder abbrechen',
  editToggleAriaLabel: 'Edit-Modus umschalten',
  blockActionsLabel: 'Block-Aktionen',
  reloading: 'Wird neu geladen…',
  mergeUpLabel: 'Mit Block darüber zusammenziehen',
  mergeDownLabel: 'Mit Block darunter zusammenziehen',
  moveUpLabel: 'Block nach oben verschieben',
  moveDownLabel: 'Block nach unten verschieben',
  deleteLabel: 'Block löschen',
  addBelowLabel: 'Neuer Block darunter',
  filesLabel: 'Dateien im Bundle',
  insertFile: (name: string) => `${name} einfügen`,
  addPictureLabel: 'Bild ins Bundle legen',
  pictureName: 'Name',
  addPicture: 'Hinzufügen',
  replacePicture: 'Ersetzen',
  pictureExists: (name: string) => `${name} gibt es schon im Bundle.`,
  onlyPngJpeg: 'Nur PNG- und JPEG-Bilder lassen sich ins Bundle legen.',
  pictureLocated: (name: string) =>
    `${name} enthält, wo es aufgenommen wurde. Die Datei behält das; die Site veröffentlicht es ohne.`,
  pastedName: 'bild',
  fileChangedReload: 'Die Datei wurde extern geändert.\nSeite wird neu geladen.',
  mergeError: (status: number, msg: string) => `Fehler beim Zusammenziehen (${status}):\n${msg}`,
  moveError: (status: number, msg: string) => `Fehler beim Verschieben (${status}):\n${msg}`,
  deleteError: (status: number, msg: string) => `Fehler beim Löschen (${status}):\n${msg}`,
  saveError: (status: number, msg: string) => `Fehler beim Speichern (${status}):\n${msg}`,
  loadBlockError: (status: number) => `Fehler beim Laden des Blocks (${status}).`,
  unknownError: 'Unbekannter Fehler',
  connectionFailed: 'Verbindung zum Server fehlgeschlagen.',
  connectionFailedRetry: 'Verbindung zum Server fehlgeschlagen. Bitte erneut versuchen.',
  connectionFailedDev: 'Verbindung zum Entwicklungsserver fehlgeschlagen.',
  blockGoneReload: 'Block nicht mehr gefunden — Seite wird neu geladen.',
  deleteDialogTitle: 'Block löschen?',
  deleteDialogBody: 'Diese Aktion kann nicht rückgängig gemacht werden.',
  cancel: 'Abbrechen',
  confirmDelete: 'Löschen',
  editAriaLabel: 'Block-Inhalt bearbeiten (Markdown)',
  save: 'Speichern',
  frontMatter: 'Front Matter',
  escToCancel: 'Abbrechen (Esc)',
  saveShortcut: 'Speichern (Strg+S)',
  parseError: (msg: string) => `Parse-Fehler — bitte Text korrigieren:\n\n${msg}`,
  parseErrorElsewhere: (msg: string) =>
    `Es gibt außerdem einen vorbestehenden Fehler an anderer Stelle im Dokument (nicht in diesem Text):\n\n${msg}`,
}

const en: typeof de = {
  editLabel: 'Edit',
  limaUnavailable: 'Lima could not be loaded: keys and errors show only when saving',
  langMenu: 'Editor language',
  langSwitchBusy: 'Save or cancel the open block first',
  editToggleAriaLabel: 'Toggle edit mode',
  blockActionsLabel: 'Block actions',
  reloading: 'Reloading…',
  mergeUpLabel: 'Merge with block above',
  mergeDownLabel: 'Merge with block below',
  moveUpLabel: 'Move block up',
  moveDownLabel: 'Move block down',
  deleteLabel: 'Delete block',
  addBelowLabel: 'New block below',
  filesLabel: 'Files in the bundle',
  insertFile: (name) => `Insert ${name}`,
  addPictureLabel: 'Add a picture to the bundle',
  pictureName: 'Name',
  addPicture: 'Add',
  replacePicture: 'Replace',
  pictureExists: (name) => `${name} is already in the bundle.`,
  onlyPngJpeg: 'Only PNG and JPEG pictures can be added to the bundle.',
  pictureLocated: (name) => `${name} says where it was taken. The file keeps that; the site publishes it without.`,
  pastedName: 'picture',
  fileChangedReload: 'The file was changed externally.\nReloading page.',
  mergeError: (status, msg) => `Error merging (${status}):\n${msg}`,
  moveError: (status, msg) => `Error moving (${status}):\n${msg}`,
  deleteError: (status, msg) => `Error deleting (${status}):\n${msg}`,
  saveError: (status, msg) => `Error saving (${status}):\n${msg}`,
  loadBlockError: (status) => `Failed to load block (${status}).`,
  unknownError: 'Unknown error',
  connectionFailed: 'Connection to the server failed.',
  connectionFailedRetry: 'Connection to the server failed. Please try again.',
  connectionFailedDev: 'Connection to the development server failed.',
  blockGoneReload: 'Block no longer found — reloading page.',
  deleteDialogTitle: 'Delete block?',
  deleteDialogBody: 'This action cannot be undone.',
  cancel: 'Cancel',
  confirmDelete: 'Delete',
  editAriaLabel: 'Edit block content (Markdown)',
  save: 'Save',
  frontMatter: 'Front matter',
  escToCancel: 'Cancel (Esc)',
  saveShortcut: 'Save (Ctrl+S)',
  parseError: (msg) => `Parse error — please fix the text:\n\n${msg}`,
  parseErrorElsewhere: (msg) =>
    `There is also a pre-existing error elsewhere in the document (not in this text):\n\n${msg}`,
}

export const T = { de, en }[LANG]

/** `url`, a /__hadley/* one, with `?lang=`, so that plugin.ts uses the same language for its messages as the UI. */
export const withLang = (url: string): string => url + (url.includes('?') ? '&' : '?') + `lang=${LANG}`
