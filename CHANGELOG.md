# Changelog

All notable changes to `@mkorun/hadley` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and hadley's versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CI on Linux, macOS and Windows: Linux and macOS pass, Windows does not yet (docs/platforms.md).
- A release workflow: the gate, the comments service and the package, each release approved by hand and published with
  a provenance attestation.
- A program for Linux, macOS and Windows that needs nothing else installed, and `install.sh` for Linux and macOS
  (docs/getting-started.md).

### Fixed

- A build stopped when the theme was reached through a symbolic link.
- `hadley dev` erased the terminal's history on Bun. It leaves the terminal as it is when it starts, and clears only
  the screen before a rebuild.

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
