# The dev server

`hadley dev`, run in the site's directory or below it (or with `--root`), builds the site, serves it with Vite and
builds it again on every change of its content, theme or `config.lima`; the page in the browser reloads.
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
moves, merges and deletes blocks. Each change is saved to the page's Markdown file, and the page reloads; a file that
changed since the page was built is not edited, the page reloads first. The editor speaks German on a German page and
English on any other. `hadley deploy` serves no editor.

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
tunnel's domain to `dev.allowedHosts`. The block editor stays off through a tunnel: it answers only under the dev
server's own host.

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
```

`dev.open` runs the program with its arguments, never through a shell. A command that needs a shell names one:
`open: [sh, -c, 'echo "open $1" | nc -q 1 host 12345', sh]`.
