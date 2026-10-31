# Sources

A site can take pages from another git repository on GitHub, such as the documentation of a program, and data, such
as the program's version: `sources` in `config.lima` names the repository, the commit to read it at, the pages and the
data. hadley reads them at every build, at that commit, builds the pages as bundles of the site and gives the data to
its templates; nothing is copied into `content/`.

```lima
sources:
  docs:                                       # the name of the source
    repository: https://github.com/mkorun/hadley   # https://github.com/<owner>/<name>
    ref: 724820d                              # a commit or a tag
    checkout: ../../../dev/hadley/monorepo    # a clone on this machine to read from (optional)
    path: docs                                # the folder of the pages (optional: the repository's root)
    root: pages                               # the root they belong to (site.md)
    urlPath: /docs/                           # the URL path they stand under
    pages:
      getting-started:
        urlPath: /docs/
        linktext: Getting started
        description: Install hadley, make a site, write its first page and publish it.
      config:
        linktext: config.lima
        description: Everything config.lima says about a site.
    data:                                     # LIMA files of path, for the templates (optional)
      hadley: facts.lima
```

A source gives pages, data or both; `root` and `urlPath` belong to its pages.

## Pages

Each entry of `pages` names a Markdown file in `path`, or at the root of the repository without one: `config` is
`docs/config.md`, a name of lower-case letters, digits and `-`, with a `.` only between two of its parts
(`lima-core-1.0-spec`). The page is the bundle `[<source>-<name>]` of `root`, `[docs-config]`, linked as `$docs-config`
and named so in a navigation; its URL path is `urlPath` and its name, `/docs/config/`, unless the entry gives its own.
The fields of an entry are front matter of the page (content.md), as if they stood at the top of its file; a field the
file's own front matter gives as well is a problem of the page. The pages are in the site's default language.

The block editor does not edit a page of a source: its text belongs to its repository.

## Data

Each entry of `data` names a LIMA file in `path`, or at the root of the repository without one, under the name the
templates read it by: `hadley: facts.lima` is `docs/facts.lima`, and a template writes its `version` as
`{ site.data.hadley.version }` (themes.md). A name is a lower-case letter and then lower-case letters and digits, and
no two sources give the same one; a file is one of `path` itself, not of a folder in it, named as a page is and ending
in `.lima`. The file is read at `ref` as the pages are, as LIMA Core in strict mode (no references); a file that does
not parse stops the build. Its values are the same in every language, and a template writes them escaped, as any
value.

## Links

A link of a page leads where it leads in the repository:

| In the page | On the site |
| --- | --- |
| another page of the source, `config.md#site` | that page, `$docs-config#site` |
| any other file of the repository, `../AGENTS.md` | the file on GitHub at `ref`, `<repository>/blob/724820d/AGENTS.md` |
| a picture beside the page in `path`, `flow.svg` | the picture, which comes with the page |

A query and an anchor stay with the link. A link that leaves the repository, a picture outside `path`, and a link
with a backslash in its path, which Windows reads as a separator, are problems of the page. A link to the web, to an
anchor of the page itself or to a path of the site (`/feed.xml`) stays as it is.

## Reading

With `checkout`, a path relative to the site or beginning with `~/`, hadley reads the pages and data from that
repository on this machine, at `ref`, whatever is checked out there. Without it, it fetches `ref` of `repository` into
`.hadley/cache/sources/`, and needs git and the network the first time. A `ref` the repository does not have stops
the build, and so does a file larger than 16 MiB or a source larger than 256 MiB. As long as `ref` stays the same, a
build reads the pages and data from `.hadley/cache/sources/`; to show a later version of them, give `ref` its commit
or tag.

## Falling behind

`ref` holds a site at one version of its pages and data: what the repository commits later reaches the site only with
a new `ref`. So that a site does not fall behind unseen, a build with `checkout` counts the commits of what is checked
out there that change one of the source's pages or data files after `ref`, and warns of them:

```text
⚠  sources.docs: 3 newer commits in /home/me/dev/tool change its files after 75b5cfe
```

The warning stops nothing; it ends when `ref` names the newest of them. A source that keeps an earlier version on
purpose, such as a frozen specification beside its current one, says so with `frozen: true`, and a build does not
count. Without a checkout to compare with, none named or none on this machine (a build from `.hadley/cache/sources/`),
a build says nothing.
