# Comments

A site takes comments when its `config.lima` says so; visitors write them in the theme's comment form, the comments
service (`hadley-forms`, `services/forms/`) keeps them, and the site's owner moderates them on their own machine with
`hadley comments`, which writes the approved ones into their article's bundle. The next build shows them.

```lima
comments:
  enabled:    true
  url:        https://example.org          # where the comments service answers in production
  authorName: Ada                          # the name the owner's replies carry
  archive:    ../private/comments          # the moderation archive, relative to the site's directory
```

## Locally

`hadley dev` starts the service with the site (`docs/dev-server.md`, "Comments"); `hadley dev comments` moderates what
was written there. The local service makes its own admin token, and its archive lies in the site's `.hadley/forms/`,
apart from the production archive.

## In production

The service runs on the site's server, one instance per site (`services/forms/systemd/hadley-forms@.service`), behind
the web server that passes `/api/comment/*` and `/admin/comments` to it. `hadley comments` reaches it at
`comments.url` with the admin token of that instance, taken from `HADLEY_COMMENTS_TOKEN` or else from the file
`~/.config/hadley/comments/<host>.token` (`$XDG_CONFIG_HOME/hadley/…`), `<host>` being the host of `site.origin`. The
file holds the token alone and must be readable by its owner only (mode 600); hadley refuses it otherwise.

The service can tell its owner of each new comment through [ntfy](https://ntfy.sh) (`NTFY_URL`, `NTFY_TOKEN`). With
`SITE_META`, the path of the site's `meta.json` on the server, the notification names the article by its title and
opens it when tapped; `meta.json` is what hadley writes next to a publish build (`.hadley/meta.json`), and the deploy
puts it beside the site's releases.

### Installing the service

Each [release of hadley](https://github.com/mkorun/hadley/releases) has the service for Linux and macOS, on amd64 and
arm64, as `hadley-forms-<version>-<os>-<arch>.tar.gz`, with `SHA256SUMS` to check a download with. The archive holds
the program, hadley's licence and those of the Go code in the program, on Linux also the systemd unit. On a Linux
server on amd64, in an empty directory:

```bash
(
  set -e
  version=0.1.0-rc.2
  file=hadley-forms-$version-linux-amd64.tar.gz
  base=https://github.com/mkorun/hadley/releases/download/v$version
  curl -fL --remote-name-all "$base/$file" "$base/SHA256SUMS"
  grep -Fx "$(sha256sum "$file")" SHA256SUMS
  tar -xzf "$file"
  sudo install -m 755 hadley-forms /usr/local/bin/hadley-forms
  sudo install -m 644 hadley-forms@.service /etc/systemd/system/
  sudo systemctl daemon-reload
  hadley-forms -version
)
```

Before the first start, make the site's data directory, for the user the service runs as, and its secrets:

```bash
site=example.org
sudo install -d -o www-data -g www-data -m 700 "/var/lib/hadley-forms/$site"
openssl rand -hex 32   # once for ADMIN_TOKEN, once for HMAC_SECRET
```

`grep` prints the line of the download in `SHA256SUMS`, and fails when it has none or the hash differs; with `set -e`,
the steps after a failed one do not run. On macOS, `shasum -a 256` takes the place of `sha256sum`. The unit starts
`/usr/local/bin/hadley-forms` as `www-data`, one instance per site; its head comment says what the site's environment
file `/etc/hadley-forms/<site>.env` holds, and `sudo systemctl enable --now hadley-forms@<site>` starts it. After an
update, `sudo systemctl restart 'hadley-forms@*'` restarts them all. There is no program for Windows; there the
service runs in WSL. To build it from the repository instead, see [dev-server.md](dev-server.md), "Comments";
`scripts/build-forms.ts` builds the files of a release.

## Moderating

`hadley comments` downloads the waiting comments and shows them one at a time, on a screen of its own; when it ends,
the terminal shows again what was there before, and below it how many comments were approved and rejected:

| Key |  |
| --- | --- |
| `a` | approve: the comment, and the reply drafted for it, go into the article's `comments.json` and `_comments.html` |
| `r` | reject, after a confirmation |
| `e` | edit the comment's text before approving it |
| `n` | a note for the archive, not published |
| `c` | draft a reply, published with the comment when it is approved |
| `m` | write a notification mail as an `.eml` file in `.hadley/mail/`, for a visitor who asked for one |
| `q` | stop; the next `hadley comments` continues where this one stopped |

Every decision is kept in the archive, with the visitor's email address; the archive is the owner's, outside the
site's published files. Once all comments of a download are decided, `hadley comments` deletes them on the service.
The tool speaks the language of `site.default.language` where it has a translation (English, German), else English.
