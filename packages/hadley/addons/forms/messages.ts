// The texts of `hadley comments` (docs/comments.md): English, and the site's language where there is a translation.

export interface Messages {
  title: string
  reply: string // the label of the owner's reply draft
  note: string
  none: string
  notifyWanted: string
  notifyDrafted: string
  replyTo: string
  keys: [key: string, label: string][]
  confirmReject: string
  approved: (name: string) => string
  rejected: string
  cancelled: string
  noteSaved: string
  replySaved: string
  mailSaved: (path: string) => string
  noArticle: (id: string) => string
  resumedLocal: (file: string, left: number) => string
  resumedServer: string
  nothingNew: string
  downloaded: (count: number) => string
  rendering: (count: number) => string
  rendered: (article: string) => string
  renderFailed: (article: string, reason: string) => string
  deletingOnService: string
  deletedOnService: string
  deleteFailed: (status: number) => string
  pending: (count: number) => string
  decided: (approved: number, rejected: number) => string
}

const en: Messages = {
  title: 'hadley comments',
  reply: 'Reply',
  note: 'Note',
  none: '—',
  notifyWanted: 'wants to be notified',
  notifyDrafted: 'notification mail written',
  replyTo: 'reply to comment',
  keys: [
    ['a', 'approve'],
    ['r', 'reject'],
    ['e', 'edit'],
    ['n', 'note'],
    ['c', 'reply'],
    ['m', 'mail'],
    ['q', 'quit'],
  ],
  confirmReject: 'Reject this comment? r: yes, any other key: no',
  approved: (name) => `Approved: ${name}`,
  rejected: 'Rejected.',
  cancelled: 'Cancelled, nothing changed.',
  noteSaved: 'Note saved.',
  replySaved: 'Reply saved; it is published with the comment when you approve it (a).',
  mailSaved: (path) => `Mail written: ${path}`,
  noArticle: (id) => `No article with the id ${id} in content/: reject it (r) or quit (q).`,
  resumedLocal: (file, left) => `Continuing the interrupted session ${file}: ${left} comment(s) left.`,
  resumedServer: 'The service still holds the last download, which was not finished; it comes again.',
  nothingNew: 'No new comments.',
  downloaded: (count) => `${count} comment(s) downloaded.`,
  rendering: (count) => `Writing the comments of ${count} article(s)…`,
  rendered: (article) => `  written: ${article}`,
  renderFailed: (article, reason) => `  failed: ${article}: ${reason}`,
  deletingOnService: 'All decided: deleting them on the service…',
  deletedOnService: 'Deleted on the service, email addresses included.',
  deleteFailed: (status) => `Deleting on the service failed (${status}); the next run downloads them again.`,
  pending: (count) => `${count} comment(s) left for the next run.`,
  decided: (approved, rejected) => `${approved} approved, ${rejected} rejected.`,
}

const de: Messages = {
  title: 'hadley comments',
  reply: 'Antwort',
  note: 'Notiz',
  none: '—',
  notifyWanted: 'möchte benachrichtigt werden',
  notifyDrafted: 'Benachrichtigung geschrieben',
  replyTo: 'Antwort auf Kommentar',
  keys: [
    ['a', 'annehmen'],
    ['r', 'ablehnen'],
    ['e', 'bearbeiten'],
    ['n', 'Notiz'],
    ['c', 'antworten'],
    ['m', 'Mail'],
    ['q', 'beenden'],
  ],
  confirmReject: 'Diesen Kommentar ablehnen? r: ja, andere Taste: nein',
  approved: (name) => `Angenommen: ${name}`,
  rejected: 'Abgelehnt.',
  cancelled: 'Abgebrochen, nichts geändert.',
  noteSaved: 'Notiz gespeichert.',
  replySaved: 'Antwort gespeichert; sie erscheint mit dem Kommentar, wenn du ihn annimmst (a).',
  mailSaved: (path) => `Mail geschrieben: ${path}`,
  noArticle: (id) => `Kein Artikel mit der ID ${id} unter content/: ablehnen (r) oder beenden (q).`,
  resumedLocal: (file, left) => `Unterbrochene Sitzung ${file} wird fortgesetzt: ${left} Kommentar(e) offen.`,
  resumedServer: 'Der Dienst hält noch den letzten, nicht beendeten Download; er kommt noch einmal.',
  nothingNew: 'Keine neuen Kommentare.',
  downloaded: (count) => `${count} Kommentar(e) heruntergeladen.`,
  rendering: (count) => `Schreibe die Kommentare von ${count} Artikel(n)…`,
  rendered: (article) => `  geschrieben: ${article}`,
  renderFailed: (article, reason) => `  fehlgeschlagen: ${article}: ${reason}`,
  deletingOnService: 'Alles entschieden: lösche sie beim Dienst…',
  deletedOnService: 'Beim Dienst gelöscht, samt E-Mail-Adressen.',
  deleteFailed: (status) => `Löschen beim Dienst fehlgeschlagen (${status}); der nächste Aufruf lädt sie erneut.`,
  pending: (count) => `${count} Kommentar(e) offen für den nächsten Aufruf.`,
  decided: (approved, rejected) => `${approved} angenommen, ${rejected} abgelehnt.`,
}

const catalogs: Record<string, Messages> = { en, de }

/** The texts in `language` where there is a translation, else in English. */
export const messagesFor = (language: string | undefined): Messages => catalogs[language ?? 'en'] ?? en
