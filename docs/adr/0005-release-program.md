# ADR 0005: A program for each system

Status: accepted by the human, 2026-10-31.

Context: hadley is a package for Node.js 24 or later. Someone who wants to write a website should not have to install a
JavaScript runtime first. hadley cannot be one file by itself: sharp with libvips, Pagefind, esbuild, rolldown and
lightningcss are native programs and libraries, which must exist as files to start.

Decision: a release carries one program per system: Linux and macOS on x64 and arm64, Windows on x64. It is a small Go
program, `services/launcher/`, with a gzipped tar inside it: Bun, Pagefind, the package and its dependencies at the
versions of `bun.lock`. Its first start unpacks them into the user's cache directory, in a directory per version and
payload; every start runs hadley with them. `install/install.sh` downloads the program of a release, checks it against
the checksum it holds, and puts it in `~/.local/bin`. The npm package stays as it is.

- `scripts/build-binary.ts` builds the programs from a commit, on Linux, the same bytes for the same commit. Install
  scripts of dependencies do not run.
- A program runs only from a directory of the user alone, with its parts there, and runs nothing it did not bring:
  it hides `BUN_*` variables from Bun, which also reads no `.env`, no `bunfig.toml` of the site and downloads nothing.
- `hadley upgrade` is the program's own: it replaces itself with the latest release, checked against that release's
  `SHA256SUMS`, and empties its directory in the cache. A prerelease also takes prereleases.
- The programs carry Pagefind without its dictionaries for Chinese and Japanese. The npm package keeps them.
- The programs need glibc. On musl hadley installs with npm.
- `check.yml` builds the programs and runs the smoke test with each on its own system; `release.yml` publishes those
  files, with a build provenance attestation.

Reasons (probes of 2026-10-31, the Windows program on a real Windows machine):

- `bun build --compile` with the same payload gave a program of 169 MiB: Bun alone is 84 MB there and stays
  uncompressed. The Go program compresses it, and gave 79 MiB with the smaller Pagefind.
- Pagefind's build with dictionaries was 49 of the 83 MB of the compressed payload; the build without them is 4 MB.
- The first start took 13 s on Windows, of which 2 s were unpacking, and each later start 0.12 s.
- Unpacked, a program takes 191 MB on Linux. Native parts cannot run from inside a single file on any of the systems.
- A tree of 3,400 files from npm's registry resolves its `^` ranges when a user installs it. A program holds what was
  tested and attested.

Costs accepted: a second Go program in the gate and an unsigned download: Windows warns about a program from a browser
until it is signed and has earned a reputation, and macOS does for a program that does not come through
`install.sh`. A version leaves its directory in the cache until `hadley upgrade` deletes it. Search in Chinese and
Japanese is weaker in a program than with the package.

Revisit if: Japanese or Chinese sites need Pagefind's dictionaries; a program can be signed; or Bun or Node.js can run
native addons from a single file.
