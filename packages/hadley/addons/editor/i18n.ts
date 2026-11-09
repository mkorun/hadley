/**
 * The block editor's server texts (its error messages), in German and English. The language is the editor's own
 * (browser/core/texts.ts: the browser's, or the one chosen in its control), which it appends as `?lang=` to every
 * `/__hadley/*` request. Without one, or with another language, the texts are English.
 *
 * The client's own texts (buttons, dialog, tooltips) are the `T` table of browser/core/texts.ts. The two tables are
 * kept apart on purpose (the browser loads no module of the server) and share no text: here are the server's error
 * messages only.
 */

export type Lang = 'de' | 'en'

export const DEFAULT_LANG: Lang = 'en'

export function resolveLang(value: string | null | undefined): Lang {
  return value === 'de' ? 'de' : DEFAULT_LANG
}

type Key =
  | 'assetNotFound'
  | 'blockNotFound'
  | 'blockFixed'
  | 'headEmpty'
  | 'headLost'
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
  | 'requestBodyInvalidUtf8'
  | 'noBundle'
  | 'pictureNameInvalid'
  | 'pictureTypeMismatch'
  | 'notThisPicture'
  | 'pictureExists'
  | 'pictureNotPlain'
  | 'pictureBroken'
  | 'pictureUnpacksTooFar'
  | 'pageUnknown'
  | 'versionUnknown'
  | 'versionNotKept'

const MESSAGES: Record<Lang, Record<Key, string>> = {
  de: {
    assetNotFound: 'Asset nicht gefunden',
    blockNotFound: 'Block nicht gefunden',
    blockFixed: 'Titel, Untertitel und Front Matter werden bearbeitet, nicht verschoben, verbunden oder gelöscht',
    headEmpty: 'Ein Titel oder Untertitel ist nicht leer',
    headLost: 'Danach wäre der Titel oder Untertitel im Text keiner mehr',
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
    requestBodyInvalidUtf8: 'Anfrage enthält kein gültiges UTF-8',
    noBundle: 'Diese Seite ist eine einzelne Markdown-Datei und hat kein Bundle für Dateien',
    pictureNameInvalid:
      'Ein Bildname besteht aus Buchstaben, Ziffern, -, _ und ., beginnt mit einem Buchstaben oder einer Ziffer und endet auf .png, .jpg oder .jpeg (höchstens 100 Zeichen)',
    pictureTypeMismatch: 'Die Endung des Namens passt nicht zur Art des Bildes',
    notThisPicture: 'Die Datei ist kein lesbares Bild der Art, die ihr Name sagt (PNG oder JPEG)',
    pictureExists: 'Im Bundle gibt es schon eine Datei dieses Namens',
    pictureNotPlain: 'Unter diesem Namen liegt keine einfache Datei; der Editor ersetzt sie nicht',
    pictureBroken: 'Das Bild ist abgeschnitten oder beschädigt; der Build könnte es nicht lesen',
    pictureUnpacksTooFar: 'Das PNG enthält gepackte Daten, die sich auf über 8 MiB entpacken',
    pageUnknown: 'Für diese Seite gibt es hier keine Versionen',
    versionUnknown: 'Diese Fassung der Seite gibt es nicht (mehr)',
    versionNotKept: 'Die aktuelle Fassung ließ sich nicht sichern; nichts geändert',
  },
  en: {
    assetNotFound: 'Asset not found',
    blockNotFound: 'Block not found',
    blockFixed: 'A title, subtitle or front matter is edited, not moved, merged or deleted',
    headEmpty: 'A title or subtitle is not empty',
    headLost: 'This would turn the title or subtitle in the text into something else',
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
    requestBodyInvalidUtf8: 'request body is not valid UTF-8',
    noBundle: 'This page is a single Markdown file and has no bundle for files',
    pictureNameInvalid:
      'A picture name is letters, digits, -, _ and ., starts with a letter or digit and ends in .png, .jpg or .jpeg (at most 100 characters)',
    pictureTypeMismatch: "The name's extension does not match the kind of picture",
    notThisPicture: 'The file is no readable picture of the kind its name says (PNG or JPEG)',
    pictureExists: 'The bundle already has a file of this name',
    pictureNotPlain: 'What lies under this name is no plain file; the editor does not replace it',
    pictureBroken: 'The picture is cut short or broken; the build could not read it',
    pictureUnpacksTooFar: 'The PNG holds packed data that unpacks to more than 8 MiB',
    pageUnknown: 'This page has no versions here',
    versionUnknown: 'There is no such version of this page (any more)',
    versionNotKept: 'Could not save the current version; nothing changed',
  },
}

export function t(lang: Lang, key: Key): string {
  return MESSAGES[lang][key]
}
