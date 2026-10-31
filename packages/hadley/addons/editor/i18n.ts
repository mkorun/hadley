/**
 * The block editor's server texts (its error messages), in German and English. The language is the page's own
 * (`document.documentElement.lang`, which the theme's templates set with `<html lang="{ meta.lang }">`); editor.js
 * appends it as `?lang=` to every `/__hadley/*` request. Without one, or with another language, the texts are English.
 *
 * The client's own texts (buttons, dialog, tooltips) are the `T` table at the top of assets/editor.js. The two tables
 * are kept apart on purpose (no build step joins them) and share no text: here are the server's error messages only.
 */

export type Lang = 'de' | 'en'

export const DEFAULT_LANG: Lang = 'en'

export function resolveLang(value: string | null | undefined): Lang {
  return value === 'de' ? 'de' : DEFAULT_LANG
}

type Key =
  | 'assetNotFound'
  | 'blockNotFound'
  | 'couldNotReadFile'
  | 'mixedLineEnds'
  | 'loneCarriageReturn'
  | 'couldNotWriteFile'
  | 'contentTypeMustBeJson'
  | 'invalidJson'
  | 'invalidRequestBody'
  | 'blockIdMissing'
  | 'newTextMissing'
  | 'directionInvalid'
  | 'fileChangedSinceOpen'
  | 'parseError'
  | 'editChangedOtherContent'
  | 'firstBlockCannotMoveUp'
  | 'lastBlockCannotMoveDown'
  | 'firstBlockHasNoPredecessor'
  | 'lastBlockHasNoSuccessor'
  | 'neighborNotTextBlock'
  | 'mergeOnlyForTextBlocks'
  | 'notFound'
  | 'requestBodyTooLarge'
  | 'requestBodyTooSlow'

const MESSAGES: Record<Lang, Record<Key, string>> = {
  de: {
    assetNotFound: 'Asset nicht gefunden',
    blockNotFound: 'Block nicht gefunden',
    couldNotReadFile: 'Datei konnte nicht gelesen werden',
    mixedLineEnds: 'Die Datei mischt LF- und CRLF-Zeilenenden; der Editor braucht eine Art durchgehend',
    loneCarriageReturn: 'Der Text enthält ein einzelnes Wagenrücklaufzeichen (\\r), das kein Zeilenende ist',
    couldNotWriteFile: 'Datei konnte nicht geschrieben werden',
    contentTypeMustBeJson: 'Content-Type muss application/json sein',
    invalidJson: 'ungültiges JSON',
    invalidRequestBody: 'ungültiger Request-Body',
    blockIdMissing: 'blockId fehlt oder ist kein String',
    newTextMissing: 'newText fehlt oder ist kein String',
    directionInvalid: 'direction muss "up" oder "down" sein',
    fileChangedSinceOpen: 'Datei wurde seit dem letzten Öffnen geändert — bitte Seite neu laden',
    parseError: 'Parse-Fehler',
    editChangedOtherContent:
      'Diese Änderung hat auch Inhalt außerhalb des bearbeiteten Blocks verändert — bitte Seite neu laden und erneut versuchen',
    firstBlockCannotMoveUp: 'Erster Block kann nicht nach oben verschoben werden',
    lastBlockCannotMoveDown: 'Letzter Block kann nicht nach unten verschoben werden',
    firstBlockHasNoPredecessor: 'Erster Block hat keinen Vorgänger',
    lastBlockHasNoSuccessor: 'Letzter Block hat keinen Nachfolger',
    neighborNotTextBlock: 'Nachbarblock ist kein Textblock',
    mergeOnlyForTextBlocks: 'Merge ist nur für Textblöcke möglich',
    notFound: 'nicht gefunden',
    requestBodyTooLarge: 'Anfrage zu groß',
    requestBodyTooSlow: 'Anfrage kam nicht rechtzeitig an',
  },
  en: {
    assetNotFound: 'Asset not found',
    blockNotFound: 'Block not found',
    couldNotReadFile: 'Could not read file',
    mixedLineEnds: 'The file mixes LF and CRLF line ends; the editor needs one kind throughout',
    loneCarriageReturn: 'The text holds a lone carriage return (\\r), which is no line end',
    couldNotWriteFile: 'Could not write file',
    contentTypeMustBeJson: 'Content-Type must be application/json',
    invalidJson: 'invalid JSON',
    invalidRequestBody: 'invalid request body',
    blockIdMissing: 'blockId missing or not a string',
    newTextMissing: 'newText missing or not a string',
    directionInvalid: 'direction must be "up" or "down"',
    fileChangedSinceOpen: 'File changed since it was opened — please reload the page',
    parseError: 'Parse error',
    editChangedOtherContent:
      'This edit also changed content outside the edited block — please reload the page and try again',
    firstBlockCannotMoveUp: 'First block cannot be moved up',
    lastBlockCannotMoveDown: 'Last block cannot be moved down',
    firstBlockHasNoPredecessor: 'First block has no predecessor',
    lastBlockHasNoSuccessor: 'Last block has no successor',
    neighborNotTextBlock: 'Neighboring block is not a text block',
    mergeOnlyForTextBlocks: 'Merge is only possible for text blocks',
    notFound: 'not found',
    requestBodyTooLarge: 'request body too large',
    requestBodyTooSlow: 'request body did not arrive in time',
  },
}

export function t(lang: Lang, key: Key): string {
  return MESSAGES[lang][key]
}
