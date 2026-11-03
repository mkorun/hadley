# Content

A page is a Markdown file of a bundle (site.md): its front matter in [Lima](https://limaformat.dev) between `---`
lines, then its text in [Markanto](https://markanto.org). Content is untrusted: hadley writes what it says escaped,
and a page cannot make hadley read outside its bundle or write outside the site's output.

## Title

A page's title is its front matter's `title` or, without one, the first block of its text when it is a `#` heading;
the bold line right after that heading (`__Subtitle__`) is then its subtitle, unless the front matter has one. A
heading or bold line that is the title or subtitle is taken out of the text, so the page shows it once. A page with
both a `title` and such a heading gives its title twice: that is a problem, which stops a publish build of the page.
`linktext` is the shorter name navigations and `llms.txt` show for a page; without it, they show its title.

## Front matter

```lima
---
publishFrom: 2026-11-02
description: How this site began.
cover: desk.jpg
category: notes
tags: [beginnings, tools]
author: $(persons/ada)
---
```

| Field |  |
| --- | --- |
| `title`, `subtitle` | the title and subtitle, where the text does not give them (above) |
| `linktext` | the shorter name navigations and `llms.txt` show |
| `htmlTitle` | the title of the browser's tab, where it is not the page's title |
| `description` | one or two sentences on the page: lists, search engines, the feed |
| `publishFrom` | the day the page is published; an article without one is undated |
| `updatedAt` | the day it was last changed, not before `publishFrom` |
| `status` | `published` (default), `draft`, `seed` or `archived` (site.md, "The states of a page") |
| `cover` | a picture of the bundle as the page's cover (themes.md, "Covers") |
| `coverStyle` | a style for the cover the theme may know, such as `ink` in hems |
| `og:image` | the page's og image instead of the one hadley makes: a file of the bundle or an http(s) URL |
| `category` | one word (site.md, "Categories and tags") |
| `tags` | a list of words |
| `author` | a person, `$(persons/<name>)` (themes.md, "Persons") |
| `archetype` | what kind of piece it is: `deep-dive`, `case-study`, `blueprint`, `manifesto`, `til`, `heuristic`, `snippet` or `spark` |
| `ai_assisted` | `true` for a text written with the help of AI; the theme says so |
| `noindex` | `true` keeps search engines from indexing the page |
| `sitemap` | `false` leaves the page out of `sitemap.xml`, the feed, the search index and `llms.txt` |
| `markdown` | `false` leaves out its Markdown twin when the site makes them (deploy.md, "Markdown for language models") |
| `urlPath` | its URL path instead of `/<file name>/`; an error page takes none (site.md) |
| `template`, `type` | another template or type than its root gives (site.md) |
| `vgwort_pixel` | the counting pixel of VG Wort; `config.lima` says how it is written (config.md, "Fields of a page") |

`config.lima` may declare more fields for its theme, and the values a field may have (config.md, "Fields of a
page"). Any other field is a problem of the page; so is a value of the wrong kind, such as a date that is no date.

## Markanto in hadley

hadley reads [Markanto](https://markanto.org) as its specification says. What it adds:

**Links.** `[text]($about)` links the page with the id `about` in the language of the page that links it;
`[text]($about#team)` a section of it. A page that is not published is no link target: its link is left out of a
published page, and marked in a dev build. A link to another site uses http, https, mailto or tel; a link to a file
of the bundle names it, relative, `[the paper](paper.pdf)`, and hadley publishes it unchanged; an HTML, XHTML, XML or
MHTML file it refuses (SECURITY.md).

**Pictures.** `![A desk by a window](desk.jpg)` is a picture of the bundle, made in the widths and formats the
page's template asks for, with its alt text as written; a picture that takes longer than 60 seconds to make stops the
build. `<m …>` around a picture sets how it is shown:

|  |  |
| --- | --- |
| `<m data-size=50%>`, `25%` | half or a quarter of the text's width |
| `<m data-size=native>` | the file as it is, not resized |
| `<m data-style=ink>`, `cameo` | a style the theme knows: line art, a round portrait in hems |
| `<m lang=fr>` | the language of its alt text and caption |
| `<m data-svg=inline>` | an SVG drawing written into the page, coloured by the theme (below) |

A picture labelled as AI-generated in its metadata (XMP) carries the theme's label and an alt text that says so.

**Drawings.** `<m data-svg=inline>![Right answers by method](accuracy.svg)</m>` writes an SVG of the bundle into the
page instead of an `<img>`, so that it takes its colours from the theme ([themes.md](themes.md), "Drawings"). A
drawing stands as a block, with a caption if it has one; its `data-size` goes on its figure as written, for the
theme to read (`native`: at the drawing's own width), and `data-style` does not apply. If `accuracy.narrow.svg` lies
beside it, the page holds both, and the theme shows the one that fits the width. On a wide screen a click enlarges a
drawing; Esc or a click beside it closes it. The file itself is published as well, as the page's Markdown twin names
it.

A drawing is content, and content is untrusted. It may hold shapes (`path`, `rect`, `circle`, `ellipse`, `line`,
`polyline`, `polygon`), text (`text`, `tspan`), `g`, `defs`, `title`, `desc`, `use`, gradients, clip paths, masks and
markers, with their geometry and presentation attributes, `id`, `role`, `aria-label`, `aria-labelledby`,
`aria-describedby`, `aria-description`, `aria-roledescription`, `aria-hidden`, and as `class` only the theme's `fig-`
classes ([themes.md](themes.md), "Drawings"). Its text is set in the page's font, or in one a `fig-` class of the
theme gives it, at the size, weight and style it gives; its own `font-family` names only generic families, unquoted
(`monospace`, `sans-serif`, `serif`, `system-ui`, `ui-monospace`, `ui-sans-serif`, `ui-serif`), which load no file
and serve the file seen on its own. A `title` or `desc` holds only text, a shape only a `title` or `desc`. A
presentation value may call colour, arithmetic and transform functions, and name nothing but an `#id` of the same file
(`url(#id)`, `<use href="#id">`); an id is a letter or `_`, then letters, digits, `_` and `-`. Anything else stops the
build, with the file and the line: a script, an event attribute, `<style>`, a `style` attribute, `<foreignObject>`,
`<image>`, a link, a URL, a font of its own, `var()`, a backslash or a CSS comment in a value, a DOCTYPE or an entity.
hadley leaves out only comments, the XML declaration and the SVG namespaces, which a page does not need, and the
root's `role`, `aria-label`, `aria-labelledby` and `aria-hidden`: the alt text names the drawing. It gives the `id`s of
each drawing a prefix of their own with a `.`, which no other id of the page has. A drawing over 32 KB (32,768 bytes)
is reported.

**Media.** `<m video preview=poster.jpg>[The walk](walk.mp4)</m>` shows a video with its poster, `<m audio>` a
sound with its picture; `<m embed>[Demo](https://example.com/embed)</m>` an embed over https.

**Blocks.** A container names what it is: `:::loud` sets a passage apart, `:::tldr` is a summary at the top, and
`:::nocount` holds text the reading time and the character count leave out.

```markdown
:::tldr
The short version.
:::
```

**Headings** get an id from their text, or the one written after them (`## Team {#team}`), and the theme's heading
template ([themes.md](themes.md), "Headings"). **Footnotes** stand after the paragraph that names them. **Code** in a
block that names its language is highlighted ([highlighting.md](highlighting.md)). With `typography: enabled: true`,
quotes, dashes and ellipses are set as the page's language sets them.
