# Platforms

hadley is made to build a site the same on Linux, macOS and Windows; so far it is tested on Linux. What differs
between them is handled in one place, `packages/hadley/lib/platform.ts`, and keeps a site from building on one system
but not on another:

- **Paths** are written with `/`, in URLs and in the output directory alike. A path in the output with a backslash,
  or with a segment in the form of a Windows short name (`PROGRA~1`), stops the build.
- **Line ends:** content, front matter and `hadley init` read `\r\n` as `\n`; a template's `\r` stays only inside
  `<pre>`. The block editor writes a file back with the line ends it has, and refuses one that mixes `\r\n` and
  `\n`; the repositories check out with `\n` (`.gitattributes`).
- **Files the operating system leaves** are neither read nor published: `.DS_Store` and `._*` (macOS), `Thumbs.db`
  and `desktop.ini` (Windows), in `content/` as in `theme/`, and content cannot name one.
- **Case:** a file content names, a template a theme includes, the logo and `config.lima` are found only as they are
  spelled, also on the file systems of macOS and Windows, which find a name in any case (a name in NFC or NFD is one
  name there). Two paths of the output that differ only in case or in normalisation stop the build.
- **URL paths** a page's directory cannot have on Windows are refused: a control character, one of `: * |`, a segment
  that ends in `.`, and the names of devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`,
  `com¹`–`com³`, `lpt¹`–`lpt³`, also with an extension).
- **Programs** hadley starts (`hadley-forms`, `mkcert`) are found on the PATH, on Windows as `.exe`. Without
  `$EDITOR`, the comments tool opens nano, on Windows Notepad.
