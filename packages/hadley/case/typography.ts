// ─── Quote characters by language ────────────────────────────────────────────

type QuotePair = [string, string] // [open, close]

// Explicit Unicode codepoints to avoid encoding ambiguity in source files.
//
//   DE  „  (U+201E) /  "  (U+201C)   ‚  (U+201A) /  '  (U+2018)
//   EN  "  (U+201C) /  "  (U+201D)   '  (U+2018) /  '  (U+2019)
//   FR  «  (U+00AB) +  U+202F / U+202F + »  (U+00BB)  (narrow no-break space inside)
//       ‹  (U+2039) +  U+202F / U+202F + ›  (U+203A)
//   ES, IT  «  (U+00AB) /  »  (U+00BB)   “  (U+201C) /  ”  (U+201D)

const LANG_QUOTES: Record<string, { dbl: QuotePair; sgl: QuotePair }> = {
  de: { dbl: ['„', '“'], sgl: ['‚', '‘'] },
  en: { dbl: ['“', '”'], sgl: ['‘', '’'] },
  fr: { dbl: ['« ', ' »'], sgl: ['‹ ', ' ›'] },
  es: { dbl: ['«', '»'], sgl: ['“', '”'] },
  it: { dbl: ['«', '»'], sgl: ['“', '”'] },
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Typography of one document: quote state and the last character run in document order. */
export interface TypographyState {
  lang: string
  inDbl: boolean // inside a double-quoted span
  inSgl: boolean // inside a single-quoted span
  lastChar: string // last processed source char (for apostrophe detection)
}

export function typographyState(lang = 'de'): TypographyState {
  return { lang, inDbl: false, inSgl: false, lastChar: '' }
}

// ─── Transformation ───────────────────────────────────────────────────────────

/**
 * Replaces ASCII punctuation in plain text with its typographic form, carrying `state` from the text before:
 *
 *   de  →  „double“ ‚single‘  (German quotation marks, DIN 5008)
 *   en  →  “double” ‘single’  (English quotation marks)
 *   fr  →  « double » ‹ single ›  (French guillemets with narrow no-break space)
 *   es, it  →  «double» “single”
 *
 * In French, a space typed before ; ! ? becomes a narrow no-break space, one before : a no-break space.
 * A language without quotes of its own keeps its quotation marks as they are typed.
 *
 * Also: --- → —  -- → –  ... → …  and an apostrophe between letters → ’. The renderer calls it for the prose of a
 * document; code, URLs and source text never reach it.
 */
export function transformText(text: string, state: TypographyState): string {
  const quotes = LANG_QUOTES[state.lang]
  let result = ''
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    // em dash: ---
    if (ch === '-' && text[i + 1] === '-' && text[i + 2] === '-') {
      result += '—'
      state.lastChar = '-'
      i += 3
      continue
    }

    // en dash: --
    if (ch === '-' && text[i + 1] === '-') {
      result += '–'
      state.lastChar = '-'
      i += 2
      continue
    }

    // ellipsis: ... or ....
    if (ch === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      result += '…'
      state.lastChar = '.'
      i += text[i + 3] === '.' ? 4 : 3
      continue
    }

    // double quote: alternating open/close
    if (ch === '"' && quotes) {
      result += state.inDbl ? quotes.dbl[1] : quotes.dbl[0]
      state.inDbl = !state.inDbl
      state.lastChar = ch
      i++
      continue
    }

    // single quote: apostrophe vs. quotation mark
    if (ch === "'") {
      const next = text[i + 1] ?? ''
      const prevIsLetter = /\p{L}/u.test(state.lastChar)
      const nextIsLetter = /\p{L}/u.test(next)

      // Apostrophe between two letters (it's, don't) OR
      // after a letter with no following letter while outside a quoted span
      // (possessive: girls', Müllers' — trailing apostrophe)
      // without quotes of its own, an apostrophe after a word may close a quote: only one between letters is sure
      if (prevIsLetter && (nextIsLetter || (quotes && !state.inSgl))) {
        result += '’' // right single quotation mark '
      } else if (!quotes) {
        result += ch
      } else if (!state.inSgl) {
        result += quotes.sgl[0]
        state.inSgl = true
      } else {
        result += quotes.sgl[1]
        state.inSgl = false
      }
      state.lastChar = ch
      i++
      continue
    }

    // French: the space before ; ! ? is a narrow no-break space, the one before : a no-break space
    if (ch === ' ' && state.lang === 'fr' && /[;!?:]/.test(text[i + 1] ?? '')) {
      result += text[i + 1] === ':' ? '\u00a0' : '\u202f'
      state.lastChar = ch
      i++
      continue
    }

    result += ch
    state.lastChar = ch
    i++
  }

  return result
}

/** Plain text such as a title, on its own. */
export function typographyText(text: string, lang = 'de'): string {
  return transformText(text, typographyState(lang))
}
