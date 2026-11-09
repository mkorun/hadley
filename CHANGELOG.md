# Changelog

All notable changes to `@mkorun/hadley` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and hadley's versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The chat with an agent beside the page, versions with undo and redo, and a block editor rebuilt in TypeScript that
brings the page up to date in place.

### Added

- The chat: with `chat: true` beside `editor: true` under `dev:` in `config.lima`, a panel beside the page in which you
  talk to an agent on this machine: Claude Code or Codex, which the dev server starts and stops itself, or a Claude
  Code session that connects through `hadley channel`. What an agent the dev server started would write, run or reach
  on the network waits for Allow or Deny in the panel; the chat answers only the browser that holds the site's key,
  which `hadley dev` prints as a link (docs/dev-server.md, "Chat"). Starting an agent is experimental.
- Rewrite: an open block's Rewrite drawer asks the agent to rewrite the block or the text selected in it, a way chosen
  (Clearer, Shorter, …) or by an instruction; the proposal takes the place of the text in the field, Take back or
  Ctrl+Z undoes it, and only saving writes it.
- Versions: the editor keeps every version of a page's Markdown, whoever wrote it, in `.hadley/history/` of the site.
  Versions in its control lists them by day, shows what restoring one would change, word by word, and keeps, restores
  or deletes them; Undo and Redo, or Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y, move the page among them, and make no version
  (docs/dev-server.md, "Versions").
- Up to date in place: after a change to the Markdown of pages alone, each open page replaces only what differs instead
  of reloading; a theme's script hears of new blocks by `hadley:content-updated` (docs/dev-server.md, "Up to date in
  place"; docs/themes.md, "Editor").
- The editor edits a page's title and subtitle where the theme marks them (docs/themes.md, "Editor"), and a badge above
  the title opens its front matter, whose keys, comments and errors Lima marks as it is typed.
- The block menu adds a new block below. Under Files the page's bundle waits: a click puts a file in at
  the caret, a picture shows larger as the pointer rests on it, and a file can be taken away into `.hadley/trash/` of
  the site. A PNG or JPEG dropped on the field or pasted into it is added to the bundle, after a question for its name.
- `<m data-exif=keep>` around a picture publishes its EXIF and location as they are (docs/content.md, "Pictures").
- `hadley dev` says, in the editor and in the terminal, when hadley's own code changed since it started.
- An article or essay without a description says so: the build warns of a published one, and the editor's front
  matter badge shows a dot while it is written.

### Changed

- The block editor is rebuilt in TypeScript, the chat a part of it, loaded only where it is on. Its control at the
  bottom right holds edit mode, Versions, Undo and Redo, the chat and the language, and steps back out of edit mode;
  one card is open at a time.
- The editor speaks the first of the browser's languages it knows, German or English, no longer the page's; its control
  shows which, and its menu keeps another for the site.
- Editing: in edit mode a double click opens a block, the cursor where the pointer was; Ctrl+Enter or Ctrl+S saves it,
  Enter stays a new line, and a link in a block leads away only with Ctrl or Cmd. The field folds Files and Rewrite into
  drawers; Save is on only where the text changed, and Cancel or Escape asks first where it did. A field being saved
  stays, locked, until the page shows its block.
- A block is deleted, moved or merged without a question; a note offers to undo it.
- Pictures no longer say where they were taken: those made in widths keep their colour profile, their XMP and the artist
  and copyright of their EXIF, but no other EXIF (location, camera, serial number); the XMP loses its location, as a
  position or a place by name, and a photo stands upright. A JPEG or PNG copied as it is loses the same, its IPTC its
  places by name, but keeps its pixels and its orientation; another picture with EXIF or a location, a WebP or AVIF say,
  fails the build. The build log says how many pictures lost their location, and the next build makes every image again.
- A dev build warns of the text of a draft or a seed that the parser could not read, as it may be missing from the
  page.
- A build's header names its site, by the host of the origin in `config.lima`.
- Lima 0.8.1 and Markanto 0.2.2.

### Fixed

- A page with a container name the parser refuses, such as `::: A|B`, hung `hadley dev` and every build (Markanto
  0.2.2); its text now stays, in the error block.
- The editor saves a block with one blank line between its parts: Enter pressed for a new paragraph left two.
- `hadley dev`: a page asked for while a rebuild is due waits for it, where a reload in that moment, after a file
  changed under the editor, showed the page as it was; and a page opened after a rebuild while none was open no longer
  loads twice.
- `hadley dev` no longer waits for a start of Vite that hangs: after 15 s it goes on where the port answers, and
  starts Vite again where it does not, once (docs/dev-server.md). It hung, rarely, in the CI on Linux, macOS and
  Windows.

### Security

- The editor's and the chat's requests are answered only on this machine, never through a proxy or tunnel, even one
  that rewrites the Host: a request with a header a proxy adds (`Forwarded`, `X-Forwarded-For`, `Via`, …) is refused.
  The site's pages still show through a tunnel.

## [0.2.0] — 2026-11-05

The second release: notes, drawings and og images that fit every site, a search index for each language, and the first
review by a native speaker.

### Added

- `robots.txt`: hadley writes it with the sitemap line, unless the site or theme has its own; `robots: signal:` in
  `config.lima` adds a `Content-Signal` line, off until set.
- Drawings: `<m data-svg=inline>` writes an SVG of the bundle into the page, checked against a list of what a drawing
  may hold, so that the theme can colour it; a `.narrow.svg` beside it is the drawing for a narrow screen, and a click
  enlarges it on a wide one (docs/content.md, "Drawings"). hems and punch colour a drawing by class, in both schemes,
  and label its button in all their languages.
- Notes: a short, dated page of its own under `notes/`, built like any page; templates list them as `noteList`, and
  `link` is a field of every page (docs/content.md, "Notes").
- og images: `ogPosition` in a page's front matter says where its og image cuts the picture, and `og:image: false`
  makes one without a picture, its title on `--og-background`.
- og images: `--og-tilt` turns the claim of `og-default.jpg`; a theme can give a cover style a colour matrix,
  `--cover-<style>`, which its templates read as `coverMatrix` and the og image uses as well (docs/themes.md,
  "Covers"); a site without a logo has its title in them.
- Templates read the AI tool a cover's metadata names as `coverAiTool`, and every page the listed articles as
  `articleList`.
- The dev server shows the Markdown twin of a page that is not published yet, such as a draft.

### Changed

- Search: an index for each language, with its word forms, now that Pagefind keeps umlauts; Pagefind 1.6.0. hems and
  punch leave out results that do not fit the words asked for.
- The output of the CLI: calmer colours, one mark for each step (◉ done, ○ running, ✕ failed, ! warnings), and a
  narrow layout that fits a phone.
- og images: an opaque picture fills the image, and a transparent one lies whole on `--og-background`.
  `og-default.jpg` is set straight and without a line under its claim: `--og-accent` is no longer required, and draws
  that line where a theme sets it. A long claim is broken into two lines.
- JSON-LD: an article names its author, else the site's owner, and its image the creator its metadata names.
- hems and punch: [@mrCabez](https://github.com/mrCabez) reviewed the Italian texts as a native speaker
  ([#6](https://github.com/mkorun/hadley/pull/6)), and what the review found in the header and the starter is fixed in
  every language. The label of an AI-generated cover is one text, `image.aiCover`, in place of `image.coverLabel` and
  `image.aiGenerated` side by side; a site's own copy of a theme is not changed.
- hems and punch say "Built with hadley" in every language. `hadley init` writes the year it runs in as `site.since`,
  and a span of copyright years takes an en dash.

### Fixed

- Texts of an image's metadata showed a character reference as written, such as `&#39;` for an apostrophe.

### Known limits

- The hang at the start of Vite in `hadley dev` was seen once on macOS (Intel) in the CI too, not only on Linux. Its
  cause is still not known: start it again.

## [0.1.0] — 2026-11-01

The first release of hadley: what the previews below brought, with nothing new since the last of them.

### Known limits

- The programs are not signed: Windows warns about one from a browser, and macOS about one that does not come through
  `install.sh`.
- Search in Chinese and Japanese is weaker in a program than with the npm package.
- The comments service, `hadley-forms`, comes for Linux and macOS; on Windows it runs only in WSL.

## [0.1.0-rc.4] — 2026-10-31

The fourth preview: the first release `hadley upgrade` can reach, to try it before 0.1.0.

### Changed

- `hadley upgrade` leaves a program winget installed to winget, and names the command.
- `hadley dev` says to start it again when Vite has not started after 15 s.

### Fixed

- `dev.open` ended the program it started after 10 s, a browser too. The program now outlives hadley.

### Known limits of the preview

- `hadley dev` has hung three times at the start of Vite, so far only on the Linux machines of the CI, and never on a
  second try. Its cause is not known: start it again.

## [0.1.0-rc.3] — 2026-10-31

The third preview: what security reviews of hadley and its four libraries found, and `hadley upgrade`. A program of
0.1.0-rc.2 cannot replace itself yet: install this one the way you installed that one.

### Security

- Markanto 0.2.1: a line of forty open brackets in a page kept a build from ever ending.
- A page cannot nest deeper than 128 levels: a list of 450 levels took 660 MB to parse, from a page of 200 KB.
- Content cannot set `data-pagefind-*`, which would change what the site's search shows and filters.
- Lima 0.7.1: a few KB of references in a page's front matter could fill the memory of a build before a limit stopped
  them. An invisible space after a date no longer moves the day.
- galley 0.3.4: a value of a page could pass the check of URL attributes (`G5001`) with characters the render removed
  afterwards, and write `href="javascript:…"` into a published page, through the themes hems and punch among others.
  A site's Content Security Policy held the script off. Update if you publish pages others wrote.
- The comments tool checks `comments.sort` like every template of the build: `{@raw}` of what a visitor wrote stops it.

### Added

- `hadley upgrade` replaces the program with the latest release (docs/cli.md).

### Changed

- A dev build writes `site.json` to `.hadley/`: in the output it was served with `--host`, to every device.
- `hadley dev` says which step it waits at when Vite has not started after 15 s.

### Fixed

- A date in quotes is read only in ISO form: `"01.03.2030"` was read by the host, and could publish a page two months
  early. It is now a problem of the page.
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

- **Content** in [Markanto](https://markanto.org), **metadata** in [Lima](https://limaformat.dev) (Core 1.2),
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
