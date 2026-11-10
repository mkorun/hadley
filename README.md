# hadley

> `0.3.0` is the latest release. The [changelog](CHANGELOG.md) names what it leaves open.

**Just write. Own your site.** A static site generator with an editor right on the page, every version kept without
Git, and a comments service of its own: one program on your machine, open source, free, with no account and no
tracking.

- **An editor on the page:** in `hadley dev`, double-click a block in the browser and write; the Markdown stays in its
  file.
- **Versions without Git:** every state of a page is kept, whoever changed it (you, another editor, an agent); compare
  them word by word, undo, restore.
- **Comments of your own:** visitors write without an account, you approve them on your own machine, and they become
  files of the article. `hadley dev` fetches the service the first time.
- **Private by default:** the themes load nothing from other servers and set no cookies; photos lose their location
  and camera before they are published.
- **Bundles:** a page is a folder with its text, its pictures and its other languages; several languages are one site.
- **Front matter in the author's language:** a field may have other names in `config.lima`, in any language and
  gendered — `titel:`, `größe:`, `題名:`, `autor:in:`, `autor*in:`.
- **Images** in the widths and formats the theme asks for, with AI-generated pictures labelled from their metadata;
  **drawings** the theme colours; **notes** beside articles.
- **Search**, a **feed**, a **sitemap**, **og images** and **`llms.txt`**, built in; **two themes** to start from,
  hems for writing and punch for a personal site, which become the site's own.
- **An agent with a safety net,** if you want one: the chat beside the page brings Claude Code or Codex; what it would
  write, run or reach waits for your Allow, and every change it makes is a version you can take back.
- **Content is untrusted:** what a page says is written escaped, and cannot make hadley read or write outside the
  site.

Built to be understood as a whole: content is written in [Markanto](https://markanto.org), Markdown as you know it with
a few things more; metadata in [Lima](https://limaformat.dev), the part of YAML that front matter needs; templates in
[galley](https://www.npmjs.com/package/@mkorun/galley), and [quad](https://www.npmjs.com/package/@mkorun/quad) formats
the HTML. [Vite](https://vite.dev), [sharp](https://sharp.pixelplumbing.com), [Shiki](https://shiki.style) and
[Pagefind](https://pagefind.app) do what they do best.

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
