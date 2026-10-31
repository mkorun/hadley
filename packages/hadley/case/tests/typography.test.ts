import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { extract } from '../index.ts'
import { typographyText } from '../typography.ts'

// Typography runs inside the renderer, on prose only; these tests drive it through extract().
const typo = (md: string, lang = 'de') => extract(md, { bundlePath: '/content/[test]', lang, typography: true }).html

// Explicit Unicode constants — avoids encoding ambiguity in source files.
const DE_DBL_OPEN = '„' // „
const DE_DBL_CLOSE = '“' // " (traditional German, DIN 5008)
const DE_SGL_OPEN = '‚' // ‚
const DE_SGL_CLOSE = '‘' // '
const EN_DBL_OPEN = '“' // "
const EN_DBL_CLOSE = '”' // "
const EN_SGL_OPEN = '‘' // '
const EN_SGL_CLOSE = '’' // '
const FR_DBL_OPEN = '« ' // «
const FR_DBL_CLOSE = ' »' //  »
const APOSTROPHE = '’' // ' (right single quotation mark, also used as apostrophe)
const EM_DASH = '—' // —
const EN_DASH = '–' // –
const ELLIPSIS = '…' // …

// ─── Dashes & Ellipsis ────────────────────────────────────────────────────────

describe('em dash / en dash / ellipsis', () => {
  test('--- → em dash', () => {
    assert.equal(typo('A---B'), `<p>A${EM_DASH}B</p>`)
  })

  test('-- → en dash', () => {
    assert.equal(typo('A--B'), `<p>A${EN_DASH}B</p>`)
  })

  test('--- takes priority over --', () => {
    assert.equal(typo('A---B--C'), `<p>A${EM_DASH}B${EN_DASH}C</p>`)
  })

  test('... → ellipsis', () => {
    assert.equal(typo('Warte...'), `<p>Warte${ELLIPSIS}</p>`)
  })

  test('.... → ellipsis (4 dots consumed)', () => {
    assert.equal(typo('Warte....'), `<p>Warte${ELLIPSIS}</p>`)
  })
})

// ─── Double quotes (de) ───────────────────────────────────────────────────────

describe('double quotes – de', () => {
  test('simple pair', () => {
    assert.equal(typo('"Hallo"', 'de'), `<p>${DE_DBL_OPEN}Hallo${DE_DBL_CLOSE}</p>`)
  })

  test('pair across an inline element', () => {
    assert.equal(typo('"Hallo *Welt*"', 'de'), `<p>${DE_DBL_OPEN}Hallo <em>Welt</em>${DE_DBL_CLOSE}</p>`)
  })

  test('two pairs in same paragraph', () => {
    assert.equal(typo('"A" und "B"', 'de'), `<p>${DE_DBL_OPEN}A${DE_DBL_CLOSE} und ${DE_DBL_OPEN}B${DE_DBL_CLOSE}</p>`)
  })
})

// ─── Double quotes (en) ───────────────────────────────────────────────────────

describe('double quotes – en', () => {
  test('simple pair', () => {
    assert.equal(typo('"Hello"', 'en'), `<p>${EN_DBL_OPEN}Hello${EN_DBL_CLOSE}</p>`)
  })
})

// ─── Double quotes (fr) ───────────────────────────────────────────────────────

describe('double quotes – fr', () => {
  test('simple pair with narrow no-break space', () => {
    assert.equal(typo('"Bonjour"', 'fr'), `<p>${FR_DBL_OPEN}Bonjour${FR_DBL_CLOSE}</p>`)
  })
})

// review 2026-10-28 (starter translations): every language but de, en and fr got German quotes
describe('quotes – es, it', () => {
  test('guillemets without space, English double quotes inside', () => {
    assert.equal(typo('"Hola \'mundo\'"', 'es'), '<p>\u00abHola \u201cmundo\u201d\u00bb</p>')
    assert.equal(typo('"Ciao"', 'it'), '<p>\u00abCiao\u00bb</p>')
  })

  test("an apostrophe after a word is an apostrophe: un po'", () => {
    assert.equal(typo("un po' di tempo", 'it'), `<p>un po${APOSTROPHE} di tempo</p>`)
  })
})

describe('quotes – a language without its own', () => {
  test('keeps them as typed, and still sets dashes and the apostrophe between letters', () => {
    assert.equal(typo("\"Hallo\" 'daar' -- zo'n", 'nl'), `<p>"Hallo" 'daar' ${EN_DASH} zo${APOSTROPHE}n</p>`)
  })
})

describe('spaces before punctuation – fr', () => {
  const NNBSP = '\u202f'
  const NBSP = '\u00a0'
  test('a typed space before ; ! ? is narrow and no-break, one before : no-break', () => {
    assert.equal(
      typo('Quoi ?! Oui ; non : peut-être !', 'fr'),
      `<p>Quoi${NNBSP}?! Oui${NNBSP}; non${NBSP}: peut-être${NNBSP}!</p>`,
    )
  })

  test('no space is added where none was typed, and other languages keep theirs', () => {
    assert.equal(typo('À 12:30 ;)', 'fr'), `<p>À 12:30${NNBSP};)</p>`)
    assert.equal(typo('Il est 9h:10', 'fr'), '<p>Il est 9h:10</p>')
    assert.equal(typo('Hello !', 'en'), '<p>Hello !</p>')
  })
})

// ─── Single quotes ────────────────────────────────────────────────────────────

describe('single quotes – de', () => {
  test('simple pair', () => {
    assert.equal(typo("'Hallo'", 'de'), `<p>${DE_SGL_OPEN}Hallo${DE_SGL_CLOSE}</p>`)
  })
})

describe('single quotes – en', () => {
  test('simple pair', () => {
    assert.equal(typo("'Hello'", 'en'), `<p>${EN_SGL_OPEN}Hello${EN_SGL_CLOSE}</p>`)
  })
})

// ─── Apostrophe ───────────────────────────────────────────────────────────────

describe('apostrophe', () => {
  test("it's → right single quote (apostrophe, between letters)", () => {
    assert.equal(typo("it's", 'en'), `<p>it${APOSTROPHE}s</p>`)
  })

  test("don't → apostrophe", () => {
    assert.equal(typo("don't", 'en'), `<p>don${APOSTROPHE}t</p>`)
  })

  test("trailing possessive apostrophe (girls')", () => {
    assert.equal(typo("girls'", 'en'), `<p>girls${APOSTROPHE}</p>`)
  })

  // review 2026-10-24: every text run started as if after a space, so an apostrophe after an inline element
  // opened a quote
  test("an apostrophe right after an inline element or code follows its last letter (*girls*' hats)", () => {
    assert.equal(typo("*girls*' hats", 'en'), `<p><em>girls</em>${APOSTROPHE} hats</p>`)
    assert.equal(typo("`Bun`'s API", 'en'), `<p><code>Bun</code>${APOSTROPHE}s API</p>`)
    assert.equal(typo("Er sagte: *'Hallo'*", 'de'), `<p>Er sagte: <em>${DE_SGL_OPEN}Hallo${DE_SGL_CLOSE}</em></p>`)
    assert.equal(typo("Zeile\\\n'Neu'", 'de'), `<p>Zeile<br>${DE_SGL_OPEN}Neu${DE_SGL_CLOSE}</p>`)
  })

  test("German trailing apostrophe (Müllers')", () => {
    assert.equal(typo("Müller's", 'de'), `<p>Müller${APOSTROPHE}s</p>`)
  })

  test('closing single quote after letter inside a quoted span', () => {
    // 'hello' — the closing ' follows 'o' (a letter) but inSgl=true → closing quote, not apostrophe
    assert.equal(typo("She said 'hello' today", 'en'), `<p>She said ${EN_SGL_OPEN}hello${EN_SGL_CLOSE} today</p>`)
  })
})

// ─── What stays untouched ─────────────────────────────────────────────────────

describe('code, URLs and attributes stay as written', () => {
  test('inline code and a code block', () => {
    assert.equal(typo('`"hello"---world`'), '<p><code>"hello"---world</code></p>')
    assert.equal(typo('```\n"hello"---world\n```\n'), '<pre tabindex="0"><code>"hello"---world\n</code></pre>')
  })

  test('text around code is transformed', () => {
    assert.equal(
      typo('"A" `"B"` "C"', 'de'),
      `<p>${DE_DBL_OPEN}A${DE_DBL_CLOSE} <code>"B"</code> ${DE_DBL_OPEN}C${DE_DBL_CLOSE}</p>`,
    )
  })

  test('the text of an autolink', () => {
    assert.equal(
      typo('Siehe https://example.com/a--b.'),
      '<p>Siehe <a href="https://example.com/a--b" target="_blank" rel="noopener noreferrer">https://example.com/a--b</a>.</p>',
    )
  })

  test('alt and title of an inline image; the title of a block image is a caption and is transformed', () => {
    assert.equal(
      typo('Text ![Ein "Bild"](https://example.com/a.png "Sein --Titel") Ende'),
      '<p>Text <img src="https://example.com/a.png" alt="Ein &quot;Bild&quot;" title="Sein --Titel"> Ende</p>',
    )
    assert.ok(
      typo('![Bild](https://example.com/a.png "Sein --Titel")\n').includes(
        `<figcaption>Sein ${EN_DASH}Titel</figcaption>`,
      ),
    )
  })

  // review 2026-10-23: the old typography split this at the > in alt and turned the code into an onerror attribute
  test('a > in an attribute value does not end the tag', () => {
    assert.equal(
      typo('Text ![x>y](https://example.com/a.png) `" onerror="alert(1)"`'),
      '<p>Text <img src="https://example.com/a.png" alt="x&gt;y"> <code>" onerror="alert(1)"</code></p>',
    )
  })

  test('nothing without the option', () => {
    assert.equal(extract('"A--B"', { bundlePath: '/content/[test]', lang: 'de' }).html, '<p>"A--B"</p>')
  })
})

// ─── Document order ───────────────────────────────────────────────────────────

describe('the quote state follows the document order', () => {
  test('a list item: its first line before its nested list', () => {
    assert.equal(
      typo('- "A\n  - B"\n'),
      `<ul>\n<li>${DE_DBL_OPEN}A\n<ul>\n<li>B${DE_DBL_CLOSE}</li>\n</ul></li>\n</ul>`,
    )
  })

  test('an exkurs: its title before its content', () => {
    assert.ok(typo('::: exkurs "Titel\nText"\n:::\n').includes(`<summary>${DE_DBL_OPEN}Titel</summary>`))
    assert.ok(typo('::: exkurs "Titel\nText"\n:::\n').includes(`Text${DE_DBL_CLOSE}`))
  })

  test('a table: its head before its body', () => {
    const html = typo('| "A |\n| --- |\n| B" |\n')
    assert.ok(html.includes(`<th>${DE_DBL_OPEN}A</th>`))
    assert.ok(html.includes(`<td>B${DE_DBL_CLOSE}</td>`))
  })
})

// ─── Plain text ───────────────────────────────────────────────────────────────

describe('typographyText', () => {
  test('transforms a title on its own', () => {
    assert.equal(typographyText('"A--B"', 'de'), `${DE_DBL_OPEN}A${EN_DASH}B${DE_DBL_CLOSE}`)
  })

  test('treats angle brackets as text', () => {
    assert.equal(typographyText("a <b>'c'", 'en'), `a <b>${EN_SGL_OPEN}c${EN_SGL_CLOSE}`)
  })

  test('no transformation on empty string', () => {
    assert.equal(typographyText(''), '')
  })
})

// ─── Mixed ────────────────────────────────────────────────────────────────────

describe('mixed transformations', () => {
  test('dashes and quotes together', () => {
    assert.equal(typo('"A--B"', 'de'), `<p>${DE_DBL_OPEN}A${EN_DASH}B${DE_DBL_CLOSE}</p>`)
  })
})
