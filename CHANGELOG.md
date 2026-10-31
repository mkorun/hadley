# Changelog

All notable changes to `@mkorun/hadley` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and hadley's versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- galley 0.3.4: a value of a page could pass the check of URL attributes (`G5001`) with characters the render removed
  afterwards, and write `href="javascript:…"` into a published page, through the themes hems and punch among others.
  A site's Content Security Policy held the script off. Update if you publish pages others wrote.
- The comments tool checks `comments.sort` like every template of the build: `{@raw}` of what a visitor wrote stops it.

### Added

- `hadley upgrade` replaces the program with the latest release (docs/cli.md).

### Changed

- A dev build writes `site.json` to `.hadley/`: in the output it was served with `--host`, to every device.

### Fixed

- A date in quotes is read only in ISO form. `publishFrom: 2030-01-01` with an invisible space after it, or
  `"01.03.2030"` in quotes, was read by the host and could publish a page a day or two months early; both are now a
  problem of the page.
- A content `data-*link` attribute is read as a destination, like `data-*href`, `data-*src` and `data-*url`: a script
  URL is refused there too.
- The comments tool refuses a language that is no name of a folder, keeps a header of the mail to one line, and writes
  the text for `$EDITOR` in a directory of the user's own.
- The comments service of `hadley dev` does not inherit `SITE_META` or `NTFY_*`, so it notifies no one of a test.
- `hadley dev` on Windows served no file of a site below a short name (`C:\Users\RUNNER~1`), and built again after
  the first build, for the files that build had read.

## [0.1.0-rc.2] — 2026-10-31

The second preview: hadley now needs nothing else installed, and passes its tests on Windows.

### Added

- CI on Linux, macOS and Windows; each must pass. On Windows the gate leaves out the comments service's contract
  tests and its Go tests of file modes and open files: the service does not start there (docs/platforms.md).
- A release workflow: the gate, the comments service and the package, each release approved by hand and published with
  a provenance attestation.
- A program for Linux, macOS and Windows that needs nothing else installed, and `install.sh` for Linux and macOS
  (docs/getting-started.md).

### Fixed

- **Security, Windows:** a page of another repository (`sources`) could link a picture whose name held backslashes
  (`..\..\x.png`), and the build wrote that file of the repository outside the site. A link with a backslash in its
  path is now a problem of the page.
- A build stopped when the theme was reached through a symbolic link.
- `hadley dev` erased the terminal's history on Bun. It leaves the terminal as it is when it starts, and clears only
  the screen before a rebuild.
- On Bun on Windows, a theme reached through a junction was published without its files.
- `hadley dev` on Windows copied the theme's files again at every build: a copy there keeps the time of its source.
- `scripts/compare-builds.ts` named the files of the output with `\` on Windows.

### Known limits of the preview

- The programs are not signed: Windows warns about one from a browser, and macOS about one that does not come through
  `install.sh`.
- Search in Chinese and Japanese is weaker in a program than with the npm package.
- The comments service, `hadley-forms`, comes for Linux and macOS; on Windows it runs only in WSL.

## [0.1.0-rc.1] — 2026-10-31

The first preview of hadley on npm, under the tag `next`, before the first release.

### What hadley does

- **Content** in [Markanto](https://markanto.org), **metadata** in [LIMA](https://limaformat.dev) (Core 1.2),
  **templates** in galley, the **HTML** formatted by quad; Vite, sharp, Shiki and Pagefind for the rest.
- **Bundles:** a page is a folder with its text, its pictures and its other languages; **several languages** make one
  site, each page linked to its versions.
- **Front matter in the author's language:** a field may have other names in `config.lima`, in any language and
  gendered (`titel:`, `größe:`, `題名:`, `autor:in:`, `autor*in:`).
- **Two themes** to start from, which become the site's own: hems, for writing, and punch, for a personal site;
  `hadley init` makes a site from either, in the languages it names.
- **Images** in the widths and formats the theme asks for, AI-generated ones labelled from their metadata.
- **A dev server** with live reload and an editor for the page in the browser; **search**, a **feed**, a **sitemap**,
  **og images** and **comments** when the site wants them.
- **Pages from other repositories** (`sources`), read at a commit, with their data for the templates.
- **A maintenance mode** that publishes only the site's 503 page, and error pages every host can show
  (`404.html`).
- **Every page as Markdown** beside `llms.txt`, for language models, when `config.lima` says so (`markdown`).
- **Content is untrusted:** what a page says is written escaped, and cannot make hadley read or write outside the site.

### Known limits of the preview

- Tested on Linux with Node.js 24 and Bun 1.4; Windows and macOS are not tested yet (docs/platforms.md).
- The comments service, `hadley-forms`, comes for Linux and macOS with the GitHub release (docs/comments.md); on
  Windows it runs only in WSL.
- hadley.sh, the website, is under maintenance; the documentation is in `docs/`.
