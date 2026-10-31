# Security

## Reporting a vulnerability

Report a vulnerability privately, through GitHub: the repository's **Security** tab, **Report a vulnerability**.
Please do not open a public issue for it. A report is answered within a week; a fix and an advisory follow, crediting
the reporter unless they ask not to be named.

## What hadley guards

hadley treats a site's content — the Markdown and front matter of its pages — as untrusted
([AGENTS.md](AGENTS.md), "Security"):

- what a page says is written escaped, never as markup; a template writes HTML only from what hadley made (`html.*`)
  and from the theme's own texts (`t.*`), and the build refuses any other;
- a page cannot make hadley read outside its bundle or write outside the site's output, on Linux, macOS or Windows
  ([docs/platforms.md](docs/platforms.md));
- a link or file a page names is checked: a scheme it may not use, another host where none may be, or a file that is
  not there stops the published page.

A way around any of these is a vulnerability. So is one in the comments service (`services/forms/`), which takes what
visitors write, and in the dev server and its editor, which write the site's files.

A page cannot publish a document a browser would run as a page: naming an HTML, XHTML, XML or MHTML file of its bundle
stops it. Its other files are published as they are, so an SVG file keeps any script it holds, and a visitor who opens
it runs that script on the site's origin, unless the site's server stops it ([docs/deploy.md](docs/deploy.md)).

Trusted like code, and outside this boundary: `config.lima`, the theme and its templates, the layout of the site's
folders. hadley sets no Content Security Policy; the site's server does ([docs/deploy.md](docs/deploy.md)).

## Supported versions

Fixes go into the latest release.
