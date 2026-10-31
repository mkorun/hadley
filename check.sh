#!/usr/bin/env bash
# The gate before every commit; docs/typescript.md ("Gate") says what it checks. Run it on its own and read its exit
# status. Checks the code does not meet yet are added when it does.
set -euo pipefail
cd "$(dirname "$0")"
bin=node_modules/.bin

"$bin/oxfmt" --check

# No secret in the history or in what is staged; gitleaks through mise, pinned here, .gitleaks.toml its exceptions.
gitleaks() { mise exec gitleaks@8.30.1 -- gitleaks "$@" --redact --no-banner --log-level warn; }
gitleaks git .
gitleaks git . --pre-commit --staged

"$bin/tsc" --noEmit -p .

# oxlint finds tsgolint only in the project's own node_modules (ADR 0003).
"$bin/oxlint" --type-aware --deny-warnings

bun scripts/check-width.ts

bun scripts/check-html.ts

# Needs Go through mise, as the comments service will (docs/typescript.md, "Regular expressions").
bun scripts/check-regex.ts

bun scripts/check-writes.ts

# Reads the templates of the themes, and of the sites in sites/ where there are any; never builds them.
bun scripts/check-templates.ts

# The starters' content and the documentation: LIMA front matter, canonical Markanto (oxfmt leaves them alone,
# .oxfmtrc.json).
bun scripts/check-content.ts

# The documentation's relative links and anchors, which hadley.sh keeps as GitHub has them.
bun scripts/check-links.ts

# Catches files that tests leave in TMPDIR; a test that writes elsewhere is outside this check.
test_tmp=$(mktemp -d)
trap 'rm -rf "$test_tmp"' EXIT
TMPDIR="$test_tmp" bun run test
# The same tests on Node.js (ADR 0002).
TMPDIR="$test_tmp" node --test 'packages/hadley/**/tests/*.test.ts' 'scripts/tests/*.test.ts'

# The comments service (docs/go.md, "Gate"), with Go through mise; its contract tests run against the binary built
# here, which lies outside TMPDIR. govulncheck reads the vulnerability database from the network.
go_bin=$(mktemp -d)
trap 'rm -rf "$test_tmp" "$go_bin"' EXIT
(
  cd services/forms
  go() { mise exec go -- go "$@"; }
  unformatted=$(mise exec go -- gofmt -l .)
  if [[ -n "$unformatted" ]]; then
    printf 'gofmt would change: %s\n' "$unformatted" >&2
    exit 1
  fi
  fixes=$(go fix -diff ./...)
  if [[ -n "$fixes" ]]; then
    printf 'go fix would change:\n%s\n' "$fixes" >&2
    exit 1
  fi
  go vet ./...
  go tool -modfile=tools.mod staticcheck ./...
  TMPDIR="$test_tmp" go test -race -count=1 ./...
  go tool -modfile=tools.mod govulncheck ./...
  go build -o "$go_bin/hadley-forms" ./cmd/hadley-forms
)
# hadley-forms does not start on Windows (lock_other.go, docs/platforms.md), so its contract tests have nothing to
# run against there.
if [[ "$OSTYPE" == msys || "$OSTYPE" == cygwin ]]; then
  echo 'check.sh: the contract tests of the comments service are left out on Windows, where hadley-forms does not run'
else
  FORMS_SERVICE="$go_bin/hadley-forms" TMPDIR="$test_tmp" bun test services/forms/tests/
fi

leftover=$(find "$test_tmp" -mindepth 1 -print -quit)
if [[ -n "$leftover" ]]; then
  printf 'the tests left files in TMPDIR: %s\n' "$leftover" >&2
  exit 1
fi
