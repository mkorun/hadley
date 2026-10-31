// eml.ts: the draft (.eml, RFC 2822) of the mail that tells a visitor their comment is published

const SUBJECT: Record<string, string> = {
  de: 'Dein Kommentar wurde veröffentlicht',
  en: 'Your comment has been published',
}

// Header-Wert von CRLF befreien (verhindert Header-Injection)
function safeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim()
}

export function generateEml(opts: {
  to: string
  name: string
  language: string
  articleTitle: string
  commentText: string
  commentId: string
  authorName: string
}): string {
  const { to, name, language, articleTitle, commentText, commentId, authorName } = opts
  const safeTo = safeHeader(to)
  const safeName = safeHeader(name)
  const lang = language === 'en' ? 'en' : 'de'
  const subject = SUBJECT[lang]
  const date = new Date().toUTCString()

  const quotedText = commentText
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

  const body =
    lang === 'en'
      ? `Hello ${safeName},

your comment on "${articleTitle}" has been published.

---
${quotedText}
---

[Your personal response here]

Best regards,
${authorName}
`
      : `Hallo ${safeName},

dein Kommentar zu „${articleTitle}" wurde veröffentlicht.

---
${quotedText}
---

[Deine persönliche Antwort hier]

Viele Grüße,
${authorName}
`

  return [
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `Date: ${date}`,
    `To: ${safeTo}`,
    `Subject: ${subject}`,
    `X-Comment-ID: ${safeHeader(commentId)}`,
    ``,
    body,
  ].join('\r\n')
}
