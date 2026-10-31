# Getting started

## Install

hadley is one program, and it needs nothing else installed.

On Linux, macOS and in WSL:

```sh
curl -fsSL https://hadley.sh/install.sh | sh
```

puts it in `~/.local/bin`.

On Windows, download `hadley-<version>-windows-amd64.exe` from the
[releases](https://github.com/mkorun/hadley/releases), name it `hadley.exe` and put it in a folder on your `PATH`.
The program is not signed yet, so Windows warns about it the first time.

`hadley upgrade` replaces the program with the latest release, once its checksum fits.

`hadley version` prints the version that runs. The first start takes a few seconds: the program unpacks what it carries
into your cache directory (`~/.cache/hadley`, `~/Library/Caches/hadley`, `%LOCALAPPDATA%\hadley`), about 200 MB. That
directory can be deleted at any time; to remove hadley, delete it and the program.

### With Node.js

Where there is no program (Linux with musl), or with Node.js 24 or later at hand, hadley installs as a package:

```sh
npm install --global @mkorun/hadley
```

`bun add --global @mkorun/hadley` installs it too; the command still starts with Node.js. The package carries Pagefind's
dictionaries for Chinese and Japanese, which the program leaves out, and search in those languages is better with it. A
checkout of the repository runs on [Bun](https://bun.sh) 1.4 as well ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## A new site

```sh
hadley init my-site
```

makes `my-site/` with the theme hems and its starter, Feather Cat: a small blog with articles, a series, pictures and
an about page, to read and make one's own. `hadley init my-site --theme punch` makes a personal site instead,
Noa Varela's, with a few posts; `--blank` gives either theme a home page, an imprint, a feed page and a 404 page, and
nothing to delete. The site is English; `--language de` makes it German, `--language de,en` German and English
([docs/init.md](init.md)).

```
my-site/
  config.lima     what the site is and how it is built (docs/config.md)
  content/        its pages, one folder each (docs/site.md)
  theme/          its theme, which is now the site's own (docs/themes.md)
```

## Work on it

```sh
cd my-site
hadley dev
```

builds the site, watches its files and serves it at <http://localhost:8000>, reloading the browser as a file changes.
With `dev: editor: true` in `config.lima`, a right click on a block of a page edits it in the browser.
[docs/dev-server.md](dev-server.md) has the rest: the editor, another port, HTTPS, a phone on the same network.

## The first page

A page is a folder in `content/`: its name in brackets is the page's id, the Markdown file in it is its text.

```
content/articles/[first-steps]/first-steps.md
```

```markdown
---
publishFrom: 2026-11-02
description: How this site began.
---

# First steps

The text, in [Markanto](https://markanto.org). A picture of the folder:

![A desk by a window](desk.jpg)

A link to another page by its id: [about this site]($about).
```

Put the picture, `desk.jpg`, in the folder beside the Markdown file: a file a page names and the bundle does not have
is a problem, which stops publishing. The first heading is the page's title. The page appears at `/first-steps/`, on
the home page and in the feed;
`status: draft` keeps it to the dev server until it is ready ([docs/content.md](content.md)).

## Publish

```sh
hadley deploy --build
```

writes the site to `.hadley/publish/`: the pages, their pictures, the theme's stylesheets and scripts under the hash
of their bytes and its other files,
the sitemap, the feed and the search index. Copy the folder to any web server; [docs/deploy.md](deploy.md) has a
server's configuration. `hadley deploy` without `--build` serves the same files locally first.
