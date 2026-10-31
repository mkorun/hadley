# Command line

```
hadley [--root <dir>] <command> [options]
```

A command works on a site: the directory `--root` names, else the one the environment variable `HADLEY_ROOT` names,
else the nearest directory, from the current one upwards, that holds a `config.lima`. `hadley <command> --help` (or
`-h`) prints a command's options; `--verbose` (or `-v`), anywhere on the line, or the environment variable `DEBUG`
adds the stack trace to a failure. A command that fails says why and exits with 1.

| Command | What it does | More |
| --- | --- | --- |
| `hadley init [dir]` | a new site in `dir` (default: here), which must be empty or not exist | [init.md](init.md) |
| `hadley dev` | builds the site, watches its files and serves it, with live reload | [dev-server.md](dev-server.md) |
| `hadley dev comments` | moderates the comments the dev server's comments service took | [comments.md](comments.md) |
| `hadley deploy` | builds the site for publishing and serves that build locally | [deploy.md](deploy.md) |
| `hadley clean` | empties the site's `.hadley/dev/`, `.hadley/publish/` and `.hadley/cache/` |  |
| `hadley comments` | moderates the comments of the site in production | [comments.md](comments.md) |
| `hadley version` | prints hadley's version |  |
| `hadley upgrade` | replaces the program with the latest release, if that is newer, and deletes what older versions unpacked; a prerelease also takes prereleases. A package updates through npm | [getting-started.md](getting-started.md#install) |

## init

| Option |  |
| --- | --- |
| `--theme <theme>` | `hems` (default) or `punch`, each with its own starter |
| `--blank` | the starter without sample content instead: home, imprint, feed and 404 |
| `--language <languages>` | `de`, `de,en` (the first is the default), or `all` the starter is written in |

## dev

| Option |  |
| --- | --- |
| `--port <n>` | another port than `dev.port` of `config.lima` or 8000; the comments service takes the next one |
| `--https` | serves over HTTPS, with a certificate from mkcert ([dev-server.md](dev-server.md)) |
| `--host` | serves every network interface too, and prints their addresses and a QR code |
| `--build` | builds once into `.hadley/dev/`, without server or watcher |

A dev build marks drafts and other unpublished pages instead of leaving them out, and keeps what it built: after
deleting a page, `hadley clean` removes its old output.

## deploy

| Option |  |
| --- | --- |
| `--build` | builds into `.hadley/publish/` only, for copying to the server |
| `--port`, `--https`, `--host` | as for `dev`, for the local server |

Without `--build`, comments go to the local server, so that the preview can be tried as it is.
