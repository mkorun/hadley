# config.lima

A site's `config.lima`, in [LIMA](https://limaformat.dev), says what the site is and how hadley builds it. A value
hadley reads and cannot use stops the build.

## site

```lima
site:
  origin: https://example.org      # the address the site is published at
  owner: $(persons/ada)            # the person the site belongs to (themes.md, "Persons")
  since: 2026                      # the first year of the copyright line
  email: hello@example.org         # an address templates may show (site.email, site.emailMailto)
  default:
    language: en                   # the site's default language
    title: Ada's notes
  en:
    locale: en_GB
    claim: Notes on type and tools
    description: The site of Ada, who writes about type and tools.
  de:
    locale: de_DE
    claim: Notizen über Schrift und Werkzeuge
    description: Die Site von Ada, die über Schrift und Werkzeuge schreibt.
```

Each language of the site is a block named after it: its `title`, `claim`, `tagline`, `description` and `locale`;
what a block leaves out comes from `default`. `origin` is the site's, `site.origin`, unless a language block gives its
own; `default` gives none. Templates read the values of
the page's language as `site.title`, `site.claim` and so on. `issn` names the site's ISSN, which `llms.txt` and the
JSON-LD give; `repository` its source, which `llms.txt` gives.

## Lists and navigation

```lima
navigations:
  main: [about]                    # page ids, in their order
  footer: [about, imprint, feed]

profiles: [github, mastodon]       # the owner's profiles the site shows (themes.md, "Persons")

featured_articles:                 # shown above the others on the home page
  - id: first-steps
    label:
      en: Start here
      de: Zum Einstieg

featured_series:                   # the latest article of a collection, above the others
  - id: travel
    label:
      en: Series
```

A navigation links a page in the language of the page that shows it, or its version in the default language where
that language has none; a page that is not listed is left out, and a dev build shows it marked. Templates read the
navigations as `navigations.main`, `navigations.footer`, the featured articles as `featuredList` (themes.md).

## Building

| Key |  |
| --- | --- |
| `typography: enabled: true` | typographic quotes, dashes and ellipses in the text, by the page's language |
| `rss: enabled: true` | a feed for each language (`/feed.xml`, `/de/feed.xml`) and its page with the `feed` template |
| `markdown: enabled: true` | a Markdown twin of every page in `llms.txt` ([deploy.md](deploy.md#markdown-for-language-models)) |
| `search: enabled: true` | a [Pagefind](https://pagefind.app) index of the published pages, which the theme searches |
| `og: enabled: true` | og images (below) |
| `maintenance: enabled: true` | the site is under maintenance: a publish build makes only its page `@errors/[503]` (site.md), at each language's home and `404.html` too, and marks the build for the server (deploy.md, "Maintenance"); `hadley dev` builds the whole site as ever |
| `highlighting` | the colours of code blocks ([highlighting.md](highlighting.md)) |
| `comments` | the comments service ([comments.md](comments.md)) |
| `templates` | a template for every page of a root: `templates: articles: post` (site.md) |
| `sources` | pages from another git repository, at a commit ([sources.md](sources.md)) |
| `theme` | the theme's settings (themes.md, "Settings") |
| `dev` | the dev server: `port`, `https`, `editor` and more ([dev-server.md](dev-server.md)) |

### og images

With `og: enabled: true`, hadley makes `og-default.jpg` for the site and an `og.jpg` for every article and essay,
from its cover or its first picture, with its title. It needs the site's logo (`--og-logo` in the theme's
`assets/css/style.css`, else `theme/assets/images/logo.svg` or `logo.png`), a `claim` in every language, and the tokens
`--og-background` and `--og-accent` in that stylesheet; a missing one stops the build with all of them named. The
title is set in Noto Sans where the system has it (`fonts-noto-core` on Debian and Ubuntu).

## Fields of a page

`metadata` declares the front matter fields a page may have beyond hadley's own (content.md), and what a field must
be, one of hadley's too, and the other names it may have:

```lima
metadata:
  category:
    allowed: [notes, essays, tools]     # any other value is a problem of the page
  mood:
    required: true                       # a page without it is a problem
    defaultValue: calm
    aliases: [stimmung]                  # another name of the field
  author:
    aliases: [autor, autorin, autor:in]  # other names of one of hadley's fields
  vgwort_pixel:
    template: '<img src="{ value }" width="1" height="1" alt="">'
    publishOnly: true                    # as text in a dev build, as HTML when publishing
```

A field's `template` is a galley template that makes the field's HTML from its value; templates write it as
`html.fields.<field>`. It escapes what it writes, as a theme's template does, and cannot include partials.

A page may write a field by any of its names, in another language or a gendered form: `größe: 3`, `題名: …`,
`autor:in: Noa`, `autor*in: Noa` and `autor·in: Noa` are LIMA keys as they stand, and a name with a space or another
character LIMA keys do not hold is quoted, `"first name": Noa`. A name counts as it is spelled (`Autor` is not `autor`),
in Unicode's composed form: a `ü` typed as `u` and a combining mark is the `ü` of config.lima. Another name belongs to
one field and is no field's own name, or the build stops. A page that gives one field twice, by two of its names or in
two forms of one, keeps the first and has a problem.

## Other lists

`packages` and `editors` are lists a theme may show as it likes (`site.packages`, `site.editors`); hadley reads
nothing in them.
