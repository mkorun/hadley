#!/bin/sh
# Installs the program hadley for this user, without root and with nothing else installed: ~/.local/bin/hadley
# (docs/getting-started.md, "Install"). Running it again puts this version in place of another.
#
#   curl -fsSL https://hadley.sh/install.sh | sh
#
# scripts/build-binary.ts fills in the version and the checksums of a release. The work is one function, called on the
# last line, so that a download cut off halfway runs nothing.
set -eu

VERSION=@version@

fail() {
  printf 'hadley install: %s\n' "$1" >&2
  exit 1
}

# This system, as a program of a release names it.
system() {
  os=$(uname -s)
  machine=$(uname -m)
  case "$os" in
    Linux)
      if ldd --version 2>&1 | grep -q musl; then
        fail 'this system uses musl, the program needs glibc; install hadley with npm (docs/getting-started.md)'
      fi
      os=linux
      ;;
    Darwin)
      os=darwin
      # a shell under Rosetta reports x86_64 on an Apple processor
      if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
        machine=arm64
      fi
      ;;
    MINGW* | MSYS* | CYGWIN*)
      fail "on Windows, download hadley-$VERSION-windows-amd64.exe from https://github.com/mkorun/hadley/releases"
      ;;
    *) fail "there is no program for $os" ;;
  esac
  case "$machine" in
    x86_64 | amd64) echo "$os-amd64" ;;
    aarch64 | arm64) echo "$os-arm64" ;;
    *) fail "there is no program for $machine" ;;
  esac
}

checksum() {
  case "$1" in
    linux-amd64) echo @sha256:linux-amd64@ ;;
    linux-arm64) echo @sha256:linux-arm64@ ;;
    darwin-amd64) echo @sha256:darwin-amd64@ ;;
    darwin-arm64) echo @sha256:darwin-arm64@ ;;
  esac
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

main() {
  case "${HOME:-}" in
    /*) ;;
    *) fail 'HOME is no absolute path' ;;
  esac
  command -v curl >/dev/null 2>&1 || fail 'curl is needed and not installed'
  target=$(system)
  bin=$HOME/.local/bin
  program=$bin/hadley
  # the program is told by a line it carries; a file that may be anything is not run to ask it
  if [ -L "$program" ] || { [ -e "$program" ] && ! grep -q 'hadley: first start, unpacking' "$program"; }; then
    fail "$program is there and is not the hadley program; move it away first"
  fi

  mkdir -p "$bin"
  download=$(mktemp "$bin/.hadley.XXXXXX")
  trap 'rm -f "$download"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf 'Downloading hadley %s for %s\n' "$VERSION" "$target"
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 20 --max-time 900 \
    -o "$download" "https://github.com/mkorun/hadley/releases/download/v$VERSION/hadley-$VERSION-$target"
  if [ "$(sha256 "$download")" != "$(checksum "$target")" ]; then
    fail 'the download is not the program of this release: its checksum differs'
  fi
  chmod 755 "$download"
  mv -f "$download" "$program"
  "$program" version

  case ":${PATH:-}:" in
    *":$bin:"*) ;;
    *) printf '%s is not on your PATH; add it in the configuration of your shell.\n' "$bin" ;;
  esac
}

main
