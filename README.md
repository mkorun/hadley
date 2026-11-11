# hadley

> `0.4.0` is the latest release. The [changelog](CHANGELOG.md) names what it leaves open.

**Just write. Own your site.** For people who write — authors, bloggers, anyone with a site of their own — who would
rather write than tinker.

hadley is a static site generator with an editor right on the page, every version of your pages kept without Git, and
a comments service of its own: one program on your machine, open source, free, with no account and no tracking.

## Just write.

- **An editor on the page:** in `hadley dev`, switch on edit mode, double-click a block and write; the Markdown stays
  in its file.
- **Versions without Git:** each page keeps its versions, whoever changed it (you, another editor, an agent); compare
  them word by word, undo, restore.
- **Comments of your own:** visitors write without an account and without a captcha service; you approve them on your
  own machine, and they become part of the article. `hadley dev` fetches the service the first time.
- **Front matter in your language:** a field may have other names in `config.lima`, in any language and gendered —
  `titel:`, `größe:`, `題名:`, `autor:in:`.
- **Everything else included:** search, several languages as one site, pictures in the widths the theme asks for
  (AI-generated ones labelled from their metadata), drawings the theme colours, notes beside articles, a feed, a
  sitemap, og images, and two themes to start from — hems for writing, punch for a personal site — which become the
  site's own.

## Bring your AI. If you want.

- **Small enough to read whole:** an agent can read all of hadley's documentation, Markanto and Lima included: about
  26,000 tokens. Given only that, an agent did five everyday tasks on a new site in under four minutes
  ([how it was measured](https://hadley.sh/agent-test/)).
- **A guide for your agent:** every new site gets an `AGENTS.md` that tells an agent which documentation to read for
  what; `CLAUDE.md` imports it for Claude Code.
- **Ready for language models:** every site publishes `llms.txt`, with its pages as Markdown if you like.
- **An agent with a safety net:** the chat beside the page brings Claude Code or Codex. Before it writes a file, runs
  a command or reaches the network, it asks you; every change it makes to a page is a version you can take back. What
  you give it goes to its provider.

## Own your site.

- **Open:** hadley and its own packages are ISC-licensed. Your pages are files in folders, in formats with a public
  specification.
- **Free:** no paid tier, no plugins to buy. A small server for the comments costs about an espresso a month, and it
  carries several sites.
- **Private:** the themes load nothing from other servers and set no cookies; photos lose their location and camera
  data by default; the server has no editor and no login.
- **Content is untrusted:** what a page says is written escaped, and cannot make hadley read or write outside the site.

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

## Questions and help

hadley is made by one person, Michael Kortstiege. If you are trying it, I am glad to help, and no question is too
small: ask in [Discussions](https://github.com/mkorun/hadley/discussions), where the answer helps others too, or write
to michael@mko.run, in English or German. Answers may take a few days.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how to work on hadley, [SECURITY.md](SECURITY.md) how to report a
vulnerability. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

[ISC](LICENSE). The fonts of the themes are under the SIL Open Font License; their files name them.
