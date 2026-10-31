# Themes

A site's theme is its `theme/` directory. It belongs to the site: a theme such as hems is copied there, and from then
on the site changes it as it likes.

```
theme/
  templates/     the pages' templates (.chase), their partials (.sort) and markup/heading.sort
  i18n/          the theme's texts, one file per language (en.lima, de.lima, …), `t` in templates
  highlighting/  the theme's own colours for code (Shiki themes), which config.lima names
  static/        files published at the root of the site (robots.txt, favicon.ico, …)
  theme.lima     the theme's settings
  …              anything else is published at its own path (assets/css/style.css → /assets/css/style.css)
```

Files the operating system leaves (`.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`) are not published
(docs/platforms.md).

## Settings

A theme names the settings a site may give it in `theme/theme.lima`, each with its default and, if it has them,
the values it allows:

```lima
settings:
  colorScheme:
    allowed: [auto, light, dark]
    defaultValue: auto
```

A site sets them in `config.lima`, under `theme`:

```lima
theme:
  colorScheme: dark
```

Templates read every setting as `site.theme.<name>`: the value `config.lima` gives it, or its default. A setting
the theme does not have, a value it does not allow, or settings for a theme without `theme.lima` stop the build.

A theme belongs to the site, so a change of how it looks is made in its templates. A setting is for what sites of the
theme often want one way and often the other, where the other way is more than a small change of a template; the
character of a theme is not a setting.

A theme may also say what a new site starts with: the blocks of `starter:` in `theme.lima` go into the `config.lima`
that `hadley init` writes (docs/init.md), such as a setting the theme wants a new site to show and the code colours it
brings. The build does not read them.

```lima
starter:
  theme:
    colorToggle: true
  highlighting:
    light: hems-light
    dark: hems-dark
```

## What a template reads

A page's template (`templates/<name>.chase`) and its partials read these values; a template writes each escaped, and
HTML only from `html.*` and `t.*`. A name hadley does not give is empty; `site.pages` and `assets` stop the build at a
page or file they do not have.

The page:

| Value |  |
| --- | --- |
| `meta` | its front matter (content.md) but for `template`, `type`, `urlPath`, `status`, `sitemap` and `markdown`; and `lang`, `charset`, `id` (its bundle's id) |
| `template`, `type`, `urlPath` | its template's name, its type, its URL path |
| `status` | `published`, `scheduled`, `draft`, `seed` or `archived`; `isDraft` for a draft or seed |
| `showBadge` | whether it is not published, which a dev build shows |
| `isArticle`, `isUpdated` | an article or essay; one with an `updatedAt` |
| `htmlTitle`, `canonicalUrl`, `markdownUrl`, `ogImage` | its title for the tab, its full URL, the full URL of its Markdown twin (or empty), the URL of its og image |
| `translations`, `hasTranslations` | its URL path by language, its own too; whether there is another |
| `categoryLabel` | its category as the theme names it in the page's language |
| `collections`, `seriesData` | its collections; each series it is part of: `items` (`title`, `urlPath`, `publishFrom`, `num`, `isCurrent`, `unpublished`), `currentNum`, `total` |
| `toc`, `hasToc` | its `##` headings (`id`, `text`), and whether there are more than two |
| `hasCode` | whether it has a code block that names its language (highlighting.md) |
| `readingTimeMinutes`, `charCount` | for an article; the characters of its text |
| `cover`, `isAiCover` | its cover as values ("Covers"); whether it is AI-generated |
| `newer`, `older` | for an article ("Newer and older") |
| `mainArticle` | for a variant, the id of its bundle's page |
| `html.markup` | its text |
| `html.cover` | its cover as a picture |
| `html.tldr` | its `:::tldr` summary |
| `html.jsonLd` | its JSON-LD, a `<script type="application/ld+json">` |
| `html.comments` | its comments, which the comments tool writes (comments.md) |
| `html.fields.<field>` | the HTML of a field `config.lima` gives a template (config.md) |

The site and the build:

| Value |  |
| --- | --- |
| `site` | the page's language: `origin`, `title`, `claim`, `tagline`, `description`, `locale`, `since`, `email`, `emailMailto`, `issn`; `home` and `searchPage`, the URL paths of its home and search pages; `theme` (its settings), `ownerLinks` ("Persons"), `navigations`, `taxonomy`, `collections`, `pages` (its listed pages by id), `packages` and `editors` (config.md, "Other lists"), `data`, the data of `sources` by their names (sources.md, "Data"), and `comments`, `search`, `rss` where `config.lima` turns them on |
| `t` | the theme's texts in the page's language (`i18n/<language>.lima`) |
| `navigations` | each navigation of `config.lima`: `id`, `title`, `urlPath`, `unpublished` |
| `homeUrl` | the home page in the page's language ("Home page") |
| `featuredList`, `articleList` | on the home page: the featured articles (with their `label`, and `isSeries` for the latest of a series), the others (with `year`, `yearChanged`, `isDraft`) |
| `feed` | where the language has a feed: its `url`, and its articles as `items` |
| `copyrightYear` | `site.since` to this year, `2026-2027`, or this year alone |
| `assets` | the URL path a theme file is published under, by its own: `assets['/assets/css/style.css']` |
| `isDevBuild`, `devFields` | whether the build is for the dev server; the fields a dev build shows of the page |

An entry of a list (`featuredList`, `articleList`, `feed.items`, `newer`, `older`) holds `urlPath`, `title`,
`subtitle`, `description`, `publishFrom`, `updatedAt`, `displayDate` (the later of the two), `isUpdated`, `status`,
`showBadge`, `category`, `categoryLabel`, `cover` and `isAiCover`.

## Headings

A theme with `templates/markup/heading.sort` writes what each heading of the content holds. The template gets the
heading's `level`, its `id` and its content as `html.text`, and the page's `t` and `meta.lang`; the heading's tag and
`id` stay hadley's. Without the file, a heading holds its content as it is.

```
{@raw html.text}{#if id}<a href="#{ id }" aria-label="{ t.heading.link }">¶</a>{/if}
```

hems: `packages/hadley/themes/hems/templates/markup/heading.sort`.

## Home page

Templates read the URL path of the home page in the language of the page they write as `homeUrl` (`/`, `/de/`): the
listed page with the `home` template. Reading it on a page whose language has none stops the build; a language with two
home pages stops it in any case.

## Newer and older

An article's template reads the articles next to it in its language as `newer` and `older`: those before and after it
in the order of the home page's list (`articleList`, newest first), each an entry as a list holds it, or `null` at
either end. Any other page has both `null`.

## Covers

A page's `cover` is its picture, which a template writes as `html.cover`. `coverStyle` names a style for it; hadley
hands it to the template as it is (`meta.coverStyle`), as it hands on the `data-style` of an image in the text
(`<m data-style=ink>`). A theme draws the styles it knows, and any other cover as it is.

An entry of a list holds the cover of its page as that page shows it: each entry of `featuredList`, `articleList` and
`feed.items` whose page shows a cover (its template has a `cover` image config) has `item.cover`, the picture as
values — `src`, `width`, `height` and `sources`, each with a `type` and a `srcset` — and `item.isAiCover`; any other
entry's `item.cover` is `null`. The template writes the picture with the `sizes` of its list, and alt text empty, as
the entry's title names the page; a theme gives its `cover` image config a width small enough for its lists. A
page's template reads its own cover the same way, as `cover`, such as for the picture its search shows:

```
{#if cover}<meta data-pagefind-meta="image[content]" content="{ cover.src }">{/if}
```

```
{#if item.cover}<picture>{#each item.cover.sources as source}<source type="{ source.type }" srcset="{ source.srcset }"
  sizes="10rem">{/each}<img src="{ item.cover.src }" alt="" width="{ item.cover.width }"
  height="{ item.cover.height }" loading="lazy"></picture>{/if}
```

## Persons

A person is a file in `content/meta/persons/`; a page names one as its `author` (`author: $(persons/odile)`),
`config.lima` one as the site's `owner`. Templates read them as `meta.author` and `site.ownerLinks`. A person's fields
are those of the site's default language; a block named after another language of the site replaces fields for its
pages, as in `config.lima`:

```lima
name: Odile Lemoine
url: $about
bio: Writes about type, tools and the slow parts of the web.
de:
  bio: Schreibt über Schrift, Werkzeuge und die langsamen Seiten des Webs.
```

A `url` written `$id` is the URL path of that page in the language of the page a template writes, as a link in the
content is; a page the language does not list stops the build.

A person's profiles are its fields `github`, `mastodon`, `linkedin`, `xing`, `npm`, `dev_to` and `bluesky`, each a
URL; the JSON-LD of the home page names all of them (`sameAs`). Which of the owner's profiles a site shows, and in
which order, `config.lima` names:

```lima
profiles: [github, mastodon]
```

Templates read them as `site.ownerLinks.profiles`, each with its `network` (`github`), its `label` (`GitHub`) and its
`url`; without `profiles` the list is empty. A name that is not a profile, or one the owner does not have, stops the
build.

## hems

hems is hadley's default theme (`packages/hadley/themes/hems/`).

Line art — an image in `<m data-style=ink>` — takes the colour of the paper in the light scheme and turns light on dark
in the dark one; so does a cover whose page sets `coverStyle: ink`. A portrait in `<m data-style=cameo>` is round: on
the paper in the light scheme, a disc of paper in the dark one.

Its settings:

| Setting | Values | Default |  |
| --- | --- | --- | --- |
| `colorScheme` | `auto`, `light`, `dark` | `auto` | `auto` follows the reader's system |
| `colorToggle` | `true`, `false` | `false` | `true`: a button in the header switches auto, light and dark; the reader's browser keeps the choice |

## punch

punch is the theme of a personal site with a few posts (`packages/hadley/themes/punch/`); `hadley init --theme punch`
makes one with its starter (docs/init.md). Its home page opens on the page's cover, as wide as the screen, with the
site's title, the home page's text and the owner's profiles (`profiles`, "Persons") on it; an image of that text in
`<m data-style=cameo>` is the round portrait above the title. The posts follow as cards with their covers
(`item.cover`). Its settings are those of hems.
