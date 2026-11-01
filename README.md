# hadley

> `0.1.0` is the first release. The [changelog](CHANGELOG.md) names what it leaves open.

A static site generator small enough to be understood as a whole. Content is written in
[Markanto](https://markanto.org), metadata in [Lima](https://limaformat.dev), templates in
[galley](https://www.npmjs.com/package/@mkorun/galley); [quad](https://www.npmjs.com/package/@mkorun/quad) formats the
HTML it writes. [Vite](https://vite.dev), [sharp](https://sharp.pixelplumbing.com), [Shiki](https://shiki.style) and
[Pagefind](https://pagefind.app) do what they do best.

- **Bundles:** a page is a folder with its text, its pictures and its other languages.
- **Several languages** as one site, each page linked to its versions.
- **Front matter in the author's language:** a field may have other names in `config.lima`, in any language and
  gendered — `titel:`, `größe:`, `題名:`, `autor:in:`, `autor*in:` — so every author of a site writes the keys they would
  write.
- **Images** in the widths and formats the theme asks for, with AI-generated pictures labelled from their metadata.
- **Two themes** to start from, which become the site's own: hems, for writing, and punch, for a personal site.
- **A dev server** with live reload and an editor for the page in the browser; **search**, a **feed**, a **sitemap**,
  **og images** and **comments** (a small service of its own) when the site wants them.
- **Content is untrusted:** what a page says is written escaped, and cannot make hadley read or write outside the
  site.

## Quick start

hadley is one program, and it needs nothing else installed. On Windows, download it from the
[releases](https://github.com/mkorun/hadley/releases). With Node.js 24 or later, `npm install --global @mkorun/hadley`
installs the package instead.

```sh
curl -fsSL https://hadley.sh/install.sh | sh
hadley init my-site                   # hems with its sample blog; --theme punch for a personal site
cd my-site
hadley dev                            # http://localhost:8000
hadley deploy --build                 # the site to publish, in .hadley/publish/
```

[Getting started](docs/getting-started.md) walks through it, from the first page to the server.

## Documentation

|  |  |
| --- | --- |
| [Getting started](docs/getting-started.md) | install, a new site, the first page, publishing |
| [Command line](docs/cli.md) | every command and option |
| [A site](docs/site.md) | its folders: content, bundles, collections, languages, the states of a page |
| [config.lima](docs/config.md) | everything a site configures |
| [Content](docs/content.md) | front matter and Markanto as hadley reads them |
| [Themes](docs/themes.md) | templates, what they read, settings; hems and punch |
| [Deploying](docs/deploy.md) | the publish build and a server for it |
| [Dev server](docs/dev-server.md) | working on a site, and the editor in the browser |
| [Comments](docs/comments.md) · [Highlighting](docs/highlighting.md) · [Platforms](docs/platforms.md) | the rest |

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how to work on hadley, [SECURITY.md](SECURITY.md) how to report a
vulnerability. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

[ISC](LICENSE). The fonts of the themes are under the SIL Open Font License; their files name them.
