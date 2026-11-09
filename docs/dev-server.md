# The dev server

`hadley dev`, run in the site's directory or below it (or with `--root`), builds the site, serves it with Vite and
builds it again on every change of its content, theme or `config.lima`; the page in the browser reloads. With the
block editor, a change to the Markdown of pages alone brings each open page up to date in place instead (below).
`hadley deploy` without `--build` serves the publish build the same way, without watching.

```bash
hadley dev                  # http://localhost:8000, or the site's port
hadley dev --port 8080      # another port, for this run
hadley dev --https          # https://localhost:8000
hadley dev --host           # also for other devices in the network
```

A browser treats `http://localhost` as a secure context, so everything a page needs (the comment widget's
`crypto.subtle` among it) works over HTTP.

Each site has its own port, `dev.port` in its `config.lima` (8000 without one), so that sites run side by side:

```lima
dev:
  port: 8010
```

The comments service takes the next port, so ports 10 apart (8000, 8010, 8020, …) leave room for it. A port that is
taken, or with comments the next one, stops the server before it starts; it does not move to another.

Vite starts in well under a second, but its start has hung, rarely, in the CI. So when it has not answered after
15 s, hadley looks whether the port answers: if it does, it goes on; if not, it makes Vite anew, once, and says so. A
second start that hangs as well stops `hadley dev` with a message.

The server answers with the files of the output directory alone, and only to localhost, addresses and the names the
user configuration gives (below); a path with `.` or `..` segments is refused. The block editor reads a page's
Markdown and saves it only for a browser on this machine, on the page's own origin.

## Block editor

A site turns the block editor on in its `config.lima`; without that, `hadley dev` does not load the editor, and
nothing writes to the site's content through the server:

```lima
dev:
  editor: true
```

With it, every page loads the editor: a right click on a block of its Markdown edits it, and the menu beside the block
adds a new block below it, moves, merges and deletes blocks. Under the field the files of the page's bundle wait (not
its Markdown, nothing hidden, no other bundle): a click puts one in at the caret, an image as `![](name)` with the caret
in its alt text. A PNG or JPEG dropped on the field, or pasted into it, is added to the page's bundle: the editor asks
for its name first, and before it replaces a file of that name, then puts it in at the caret. The file is saved as it
is; one that says where it was taken is marked, and the site publishes it without that (content.md, "Pictures"). A page
that is one `.md` file has no bundle, and so no files. A right click on the page's title or subtitle, where the theme
marks it (themes.md, "Editor"), edits its text, while its `#` or `__` stays as it is, or the front matter where that
gives it; they are never moved, merged or deleted. In edit mode a badge above the title opens the page's front matter,
which Lima must read when it is saved; its lines are striped, its keys and comments marked where Lima finds them, and a
line Lima refuses is marked as it is typed, with Lima's message below. Each change is saved to the page's Markdown file,
and the page is brought up to date in place; a file that changed since the page was built is not edited, the page
reloads first. The editor is
the author's tool, not part of the page: it speaks the first of the browser's languages it knows (German, English), else
English; its control at the bottom right shows the language it speaks, and its menu keeps another for the site. Out of
edit mode the control steps back, until the pointer or the keyboard comes to it. `hadley deploy` serves no editor.

### Up to date in place

With the block editor, when only the Markdown of pages changed, by the editor, the chat's agent or another program,
each open page fetches itself once the dev server has built it, and replaces only the blocks that differ, and outside
them the smallest element that differs, such as a reading time; its title, description and JSON-LD follow too. Scroll
position, an open card and the chat stay, and a page that did not change does nothing. After a change of its own the
editor waits, the changed block dimmed, until the page is up to date; a change from outside waits while a field is
open; a rebuild that fails frees the editor and says so. The page reloads as before when anything else changed (the
theme, `config.lima`, data, pictures), when a stylesheet or script of the page's head differs, when nothing comes
within 15 seconds, and on any error. A theme whose scripts hang on blocks of the content hears of the new ones
(themes.md, "Editor").

### Versions

The editor keeps every version of a page's Markdown file the dev server sees, whoever wrote it: the editor, the chat's
agent or another program. When the build reads a page that changed since its last version, the page is kept as it is
now; the editor keeps the page before and after each of its changes, with what it did. In edit mode, Versions in the
control at the bottom right lists them by day, newest first, with when, by whom and what; a page that changed while the
chat's agent was working is said to have changed while it worked, which is all the dev server knows. One opened in its
row shows what restoring it would change: a line that goes with −, one that comes with +, and in a line changed for
another the words that differ. Restore asks first, writes it to the file as any change does, and keeps the page it
replaces as a version, so that going forward again is as easy. Keep gives a version a name, such as "before the
rework", and a kept version stays; of the unnamed, the last 100 of each page stay. A version can be deleted, after a
question, and so can every unnamed one at once; the page as it is never. The versions
live in `.hadley/history/` of the site, each state once, never in its repository, and `hadley clean` leaves them; they
need nothing but hadley, on any system. A page of more than 5,000 lines, or two versions that differ in too much of it,
are not compared, only restored.

## Chat

A site with the block editor can also turn on the chat: a panel in which you talk to an agent on this machine, Claude
Code or Codex, which the dev server starts itself, or a Claude Code session that connects through a channel.

```lima
dev:
  editor: true
  chat: true
```

`chat: true` without `editor: true` stops `hadley dev`. The editor's control at the bottom right of each page has two
halves: Edit turns edit mode on and off, the chat's half opens the panel, and its dot says the state: green connected,
the accent a reply not seen yet, amber a permission to give, hollow no session. The panel opens as a card above the
control, with the talk, the permissions and the field; its larger button makes it a panel beside the page, with the
details of each request, and on a phone the whole screen. The panel names the agent, Claude Code or Codex, or as a
channel's session names itself when it connects (MCP's `clientInfo`), and the AI until one does. A message names the
page it was sent from. The agent's answers and its requests to use a tool appear in the panel; Allow and Deny answer a
request. Escape or the chat's half closes the panel. Its open state, its size and the unsent draft survive a page
reload in this tab; what was said stays while the dev server runs. Each message names `root`, the absolute directory
the dev server serves; `file` is relative to `root`. The agent works in that directory and nowhere else for that
message.

The chat answers only a browser that holds the site's key. A page's origin, which a browser cannot fake, a program on
the same machine can: without the key it could read the conversation, send messages and allow what the agent asks to do.
In a terminal, `hadley dev` prints a link with the key (`Chat: open http://localhost:8000/__hadley/chat/unlock#…`). Its
page keeps the key in the browser's storage for that origin, which scheme, host and port bound (a cookie would go to
every port of localhost), and goes on to the site's home; the key stands after `#`, which no request carries. The panel
sends it with each request, and the panel of a browser without one says how to get it. The key is the site's, kept in a
file only its user can read, beside the channel's rendezvous, so a browser opens the link once and keeps the chat across
restarts of the dev server. Where the output is no terminal, the dev server prints the file instead of the key. The
unlock page keeps a key only once the server took it, so no other page can replace it with a wrong one, and no frame may
hold it. Programs of the same user can read that file, as they can everything of that user's, the browser's history
among it, which keeps the link.

An open block's toolbar has, after Save (Ctrl+S) and Cancel (Esc), a way to rewrite it (Clearer, Shorter, More formal,
More casual, Only fix errors, or Only instructions), a field for an instruction, which adds to the way and is all of
Only instructions, and a button that asks the agent, as Ctrl+Enter in the editing field does. It rewrites the text
selected in the editing field, or the whole block, as the button's name says; a selection also shows beside it with its
length. While the agent works, the toolbar counts the seconds, and shows a check once the proposal is in, with Undo
beside it. The agent answers with a proposal, not a change: it takes the place of the block's text or of the selection,
selected, in the editing field, Ctrl+Z takes it back, and only saving writes it to the file, as any edit. If the text
has changed while the agent was answering, or the block was closed, the proposal waits in the panel instead, to insert,
copy or discard. Each request shows how long it has been waiting, and each answer how long it took.

### An agent the dev server starts

Without an agent, the panel offers to start one: Claude Code where `claude` is on the `PATH`, Codex where `codex` is, or
the programs `dev.claude` and `dev.codex` of the user configuration name (below). With neither, the panel says so, and
`hadley dev` warns as it starts. The dev server starts the program in the background, with your own login, in the
site's directory, and gives it one message after another; a message sent while the agent works waits its turn. Stop in
the panel ends it, as does the end of the dev server.

Whatever the agent's own settings allow, everything it would do that writes, runs a command or reaches the network
waits for Allow or Deny in the panel: Claude Code runs with the permission mode `default` and an `ask` rule for those
tools, and without MCP servers; Codex with the approval policy `untrusted`, in a sandbox that writes only in the site.
The agent is told not to try a denied request again, or another way. A rewrite needs no tool: the dev server denies a
request during one itself, and the panel says so.

The conversation goes on at the next start: the dev server keeps its id in `.hadley/chat/` of the site, and the panel
says whether it could continue it. New conversation begins another. This way of starting an agent is experimental: it
drives `claude -p` with `stream-json` and `codex app-server`, which can change with their versions.

### A session through a channel

A Claude Code session in a terminal can be the agent instead, through a channel; a dev server has one agent at a time,
so a channel does not connect while one runs in the background, and the panel starts none while a channel is connected.
Claude Code starts `hadley channel` itself, from an `.mcp.json` in the directory it starts in:

```json
{ "mcpServers": { "hadley": { "command": "hadley", "args": ["channel"] } } }
```

While Claude Code's channels are a research preview, a channel that is not on Anthropic's allowlist needs the
development flag, for a new session or one that goes on:

```bash
claude --dangerously-load-development-channels server:hadley
claude --resume <session> --dangerously-load-development-channels server:hadley
```

To let answers through without asking each time, add `mcp__hadley__reply` and `mcp__hadley__suggest` to
`permissions.allow` in Claude Code settings (or choose "Yes, and don't ask again" for each tool when offered); see
[Claude Code permissions](https://code.claude.com/docs/en/permissions). Allow and Deny in the panel answer only the
current request and do not save a rule.

Replies support paragraphs, inline code, fenced code and HTTP(S) links; other markup stays text.

Set `HADLEY_CHAT_LOG` to a file in the environment Claude Code starts in, and `hadley channel` writes every line it
exchanges with Claude Code and with each dev server to it, with a timestamp, readable by you alone; without it, nothing
is logged. The panel's **Details** switch shows each request's timeline: sent, delivered, a permission and the answer.

`hadley channel --help` describes the stdio command; it needs no site directory.

`hadley channel` connects to every dev server of the same user with the chat on, so several sites can run at once.
Each of them leaves a file with its port and a token, readable by that user alone, in `$XDG_RUNTIME_DIR/hadley/chat/`
(else in the system's temporary directory, on Windows in `%LOCALAPPDATA%\hadley\run\chat`), and removes it when it ends.
Like the editor, the chat answers only a browser on this machine, on the page's own origin. From another machine,
forward the port over SSH, `ssh -L 8000:localhost:8000 <machine>`, and open `http://localhost:8000`. `hadley deploy`
serves no chat.

## Comments

With `comments.enabled: true` in `config.lima`, the dev server starts the comments service `hadley-forms`
(`services/forms/`) on the next port (8001 for 8000) and passes `/api/comment/` and `/admin/` to it: the first
`hadley-forms` on the `PATH`, or the program `dev.forms` of the user configuration names (below). Without one, comments
are off and the dev server says so. The program of a release ([comments.md](comments.md), "Installing the service")
in `~/.local/bin/` serves; or build it, in `services/forms/`:

```bash
mise exec go -- go build -o ~/.local/bin/hadley-forms ./cmd/hadley-forms
```

The local service keeps its comments, and the secrets it makes on its first start, in the site's `.hadley/forms/`. A
local build sends comments to the page's own origin, so the comment widget works on any port, over HTTPS and from
other devices; `config.lima` names only the production service (`comments.url`). `hadley dev comments` moderates the
local service (`--port` as for `hadley dev`), with the admin token from `.hadley/forms/dev-secrets.json`.

## HTTPS

`hadley dev --https` serves over HTTPS with a certificate for `localhost`:

- **mkcert:** with [mkcert](https://github.com/FiloSottile/mkcert) on the PATH, hadley makes the certificate once
  into `~/.config/hadley/certs/`. hadley installs no certificate authority; run `mkcert -install` once so that the
  browser trusts it. On WSL, a browser on Windows trusts it once mkcert's root is imported there: `mkcert -CAROOT`
  names the directory; in PowerShell, `certutil -user -addstore Root rootCA.pem` (the `.pem`, never
  `rootCA-key.pem`).
- **Your own files:** name them in the user configuration (below); a relative path is relative to that file.

Without either, `hadley dev --https` stops and says how to get one.

## Other devices

`hadley dev --host` listens on every network interface and shows where other devices reach it: the name the user
configuration gives this machine (`dev.hostname`, or `HADLEY_DEV_HOST`), then each IPv4 address, the first one also
as a QR code when the optional package `uqr` is installed. Vite answers to addresses and to that name; any other name
needs `dev.allowedHosts`. With `--https`, a phone trusts the certificate only when it names the address the phone
uses and the phone trusts its authority; HTTP is simpler on a home network.

On WSL, other devices reach Linux only in mirrored networking mode, and the Hyper-V firewall must let the port in
([WSL networking](https://learn.microsoft.com/windows/wsl/networking)); in NAT mode, `hadley dev --host` says so
instead of showing addresses no other device reaches. In `%UserProfile%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

then, after `wsl --shutdown`, in PowerShell as administrator:

```powershell
New-NetFirewallHyperVRule -Name hadley-dev -DisplayName "hadley dev" -Direction Inbound `
  -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 8000
```

A virtual machine on a NAT network (libvirt's default `virbr0`, 192.168.122.x) is not reachable from other devices
either, and hadley cannot tell; give it a bridged network or forward the port on its host.

### Tunnels

A tunnel reaches the dev server from outside the network. hadley comes with none; each of these is its own program,
and its provider terminates TLS and sees every request and page, so use it for a site without secrets. Add the
tunnel's domain to `dev.allowedHosts`. The block editor and the chat stay off through a tunnel: they answer only
under the dev server's own host.

- **cloudflared** (no account): `cloudflared tunnel --url http://localhost:8000` prints a public
  `*.trycloudflare.com` URL, new on every start; anyone who has it can open the site. Allow `.trycloudflare.com`.
- **Tailscale:** on a device in the same tailnet, `hadley dev --host` is reachable at the machine's tailnet address
  or MagicDNS name (set it as `dev.hostname`); `tailscale serve 8000` gives HTTPS at `*.ts.net` (allow `.ts.net`).
  Traffic stays in the tailnet.
- **VS Code port forwarding:** forward port 8000 in the Ports view; the URL is `*.devtunnels.ms` (allow
  `.devtunnels.ms`), private to your GitHub account unless you make it public.

## The user configuration

What belongs to the machine rather than to a site lives in `~/.config/hadley/config.lima` (or
`$XDG_CONFIG_HOME/hadley/config.lima`). The file and every key are optional; create it by hand. A key hadley does not
know stops it.

```lima
dev:
  hostname: workstation.fritz.box   # the name other devices reach this machine by (--host)
  https:
    cert: certs/localhost.pem       # your own certificate for --https
    key:  certs/localhost-key.pem
  allowedHosts: [.trycloudflare.com] # other names the dev server answers to (a tunnel's)
  open: [wslview]                   # opens the browser at start; the URL is added as the last argument
  forms: /opt/hadley/hadley-forms   # the comments service, instead of hadley-forms on the PATH
  claude: /usr/local/bin/claude     # Claude Code for the chat, instead of claude on the PATH
  codex: /opt/codex/bin/codex       # Codex for the chat, instead of codex on the PATH
```

`dev.open` runs the program with its arguments, never through a shell, and leaves it running when hadley ends. A command
that needs a shell names one: `open: [sh, -c, 'echo "open $1" | nc -q 1 host 12345', sh]`.
