# Platforms

hadley is made to build a site the same on Linux, macOS and Windows. The CI (`.github/workflows/check.yml`) runs the
gate (`check.sh`) and the smoke test on Ubuntu 24.04, macOS 15 and Windows Server 2025, in Git Bash there, for every
push to `main`, every pull request and every release; each of the three must pass. The release files of the comments
service are built on Linux only (`scripts/build-forms.ts`).

The comments service, `hadley-forms`, runs on Linux and macOS; on Windows it does not start, and runs in WSL instead
(`services/forms/lock_other.go`). The gate on Windows builds it and runs its Go checks, but leaves out its contract
tests and the Go tests of what it does with the modes of its files and with a file it replaces while it is open.

The programs of a release ([ADR 0005](adr/0005-release-program.md)) are built on Linux too, for Linux and macOS on x64
and arm64 and for Windows on x64, and each runs the smoke test on its own system. On Linux they need glibc.

What differs between the systems is handled in one place, `packages/hadley/lib/platform.ts`, and keeps a site from
building on one system but not on another:

- **Paths** are written with `/`, in URLs and in the output directory alike. A path in the output with a backslash,
  or with a segment in the form of a Windows short name (`PROGRA~1`), stops the build. A page of another repository
  (`sources`) that links a path with a backslash has a problem ([sources.md](sources.md), "Links").
- **Links:** a theme, the files of `content/meta` and a starter are read below their real paths, so one reached
  through a link, a junction on Windows among them, is read like any other.
- **Line ends:** content, front matter and `hadley init` read `\r\n` as `\n`; a template's `\r` stays only inside
  `<pre>`. The block editor writes a file back with the line ends it has, and refuses one that mixes `\r\n` and
  `\n`; the repositories check out with `\n` (`.gitattributes`).
- **Files the operating system leaves** are neither read nor published: `.DS_Store` and `._*` (macOS), `Thumbs.db`
  and `desktop.ini` (Windows), in `content/` as in `theme/`, and content cannot name one.
- **Case:** a file content names, a template a theme includes, the logo and `config.lima` are found only as they are
  spelled, also on the file systems of macOS and Windows, which find a name in any case (a name in NFC or NFD is one
  name there). On Windows a name that file system reads as another file, a stream (`a.png::$DATA`), a device
  (`con.png`) or a short name (`A-4W~1.WEB`), names no file either. Two paths of the output that differ only in case
  or in normalisation stop the build.
- **URL paths** a page's directory cannot have on Windows are refused: a control character, one of `: * |`, a segment
  that ends in `.`, and the names of devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`,
  `com¹`–`com³`, `lpt¹`–`lpt³`, also with an extension).
- **File modes:** on Linux and macOS a file's mode says who may read it, and `hadley comments` refuses an admin token
  that others can read. Windows keeps no such mode; there the user's own directory keeps the token private.
- **Programs** hadley starts (`hadley-forms`, `mkcert`) are found on the PATH, on Windows as `.exe`. Without
  `$EDITOR`, the comments tool opens nano, on Windows Notepad.
