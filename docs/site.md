# A site

```
config.lima                  what the site is and how it is built (config.md)
content/
  articles/                  the folders of the content, each a root: articles, essays, pages, notes
    [first-steps]/           a bundle: one page, its files, its languages
      first-steps.md         the page in the site's default language
      desk.jpg               a file the page names
      de/erste-schritte.md   the page in German
    @travel/                 a collection: bundles that belong together, such as a series
      [lisbon]/lisbon.md
  pages/
    [about]/about.md
    @errors/[404]/404.md     the error pages, at /errors/404/
  meta/
    persons/ada.lima         a person (themes.md, "Persons"), and other LIMA the pages refer to
theme/                       the site's theme (themes.md)
.hadley/                     what hadley builds and caches; not part of the site
```

## Bundles

A bundle is a folder named by its id in brackets, `[first-steps]`. It holds its page in the site's default language,
`<id>.md`; the same page in another language in a folder named after the language, `de/<slug>.md`; and the files its
pages name, pictures and downloads. A file of the bundle that no page names is not published. A file whose name is all
capitals, such as `README.md` or `NOTES.md`, is no page.

A file `_<name>.md` beside the page, or in a language's folder, is a variant: another page of the same piece, at
`/<name>/` (`/de/<name>/` in German), with the id `<id>_<name>`. It shares the comments of its bundle's page, needs no
`publishFrom`, and templates read its bundle's page as `mainArticle` (themes.md).

A page is linked by its id, `[about this site]($about)`, in whatever language it is read: the link leads to the version
of its language.

Bundles can also come from another git repository, at a commit `config.lima` names ([sources.md](sources.md)).

## Roots and types

The folders of `content/` are its roots. A root gives its pages their type, its name without the plural s:

| Root | Type |  |
| --- | --- | --- |
| `articles/` | article | dated; in the home page's list, the feed and the search; an og image when the site makes them |
| `essays/` | essay | as an article |
| `pages/` | page | a page of its own, listed only where a navigation or a template names it |
| `notes/` | note | no page of its own; a note may also stand alone as a `.md` file |

The front matter's `type` gives a page another type, `template` another template; `templates` of `config.lima` gives a
whole root one (config.md). Without either, a page's template is its root's type: `templates/article.chase`.

## Collections

A folder named `@name` in a root holds bundles that belong together. Two or more listed pages of a collection are a
series: their templates read them as `seriesData`, in the order of their dates. `@errors` holds the error pages, which
no list, sitemap or search shows: `[404]` for a page that is not there, and `[503]` for a site under maintenance
(config.md, `maintenance`). An error page's address is hadley's, `/errors/404/` and `/de/errors/404/`, as a server
finds it by its number (deploy.md); its front matter takes no `urlPath`. A server shows it at whatever address failed,
so its images and files stay in its bundle, but its HTML names them from its own URL path
(`/errors/503/loft-960w.webp`), never beside it.

## Languages

The site's languages are the blocks of `site:` in `config.lima`, its default language `site.default.language`. A
page in the default language lies in the bundle, in another language in the bundle's folder of that language. Its URL
path is its file's name, `/first-steps/`, and `/de/erste-schritte/` in German; the front matter's `urlPath` sets
another one.

## The states of a page

| `status` | Dev build | Publish build |
| --- | --- | --- |
| `published` (default) | written, listed | written, listed, linked |
| with a `publishFrom` still to come | marked as scheduled | not written until that day |
| `draft` | written, marked | not written; a link to it is left out |
| `seed` | written, marked | not written; an idea, not yet a draft |
| `archived` | written, marked | written under its URL, linked and listed nowhere, not indexed |

## Categories and tags

A page's `category` is one word; the theme names it in each language (`categories` in its `i18n` files), and
`config.lima` may name the words a page may use (`metadata.category.allowed`). `tags` is a list. Templates read the
pages of each as `site.taxonomy`.
