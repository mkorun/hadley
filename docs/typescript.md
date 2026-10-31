# TypeScript in hadley

The base is the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide). This file only adds what
hadley decided on top of it, and names where hadley deviates.

## Deviations from the Google guide

- **Formatting** is whatever `oxfmt` produces with the repository's configuration (ADR 0003): two spaces, no
  semicolons, single quotes, trailing commas, line width 120. The guide's formatting rules do not apply.
- **Tooling:** the guide's companion tools (`gts`, ESLint) are not used; the gate below replaces them.

## Runtime and modules

- Sources are to run unchanged on Bun and on Node.js ≥ 24 (ADR 0001, migration in progress): erasable syntax only,
  type-only imports marked as such, relative imports with their `.ts` extension.
- Named exports only (as the guide says); a default export stays only where a third-party package requires one.
- Runtime-specific APIs (`Bun.*`, `bun:*`) stay behind one module per concern; everything else uses `node:` modules.
- A module that runs as a program keeps its side effects behind `if (import.meta.main)`; importing it starts nothing.
- External programs run with argument arrays and a timeout.

## Values from outside

- Everything that enters from outside is `unknown` until checked: `config.lima`, front matter, JSON files, environment
  variables, command-line arguments, HTTP bodies. It is checked once, where it enters; code after that trusts it.
- `any` is a deliberate, commented opt-out, never a shortcut.
- A failure names the file and the field. No silent fallback: an unknown value stops with a message (AGENTS.md, "Never
  guess"); a warning is only for what the human may legitimately leave open.

## Types and data

- `strict` and `exactOptionalPropertyTypes` are on; `noUncheckedIndexedAccess` follows as its own migration.
- Data with a closed set of shapes is a discriminated union with an exhaustive `switch`, not a class hierarchy.
- Errors are `Error` objects (with `cause` where one exists); each layer adds context once; the command-line entry
  reports and sets the exit status.

## Regular expressions

- Regular expressions are literals in RE2 syntax: no lookaround, no backreferences, no `RegExp` built at run time.
  RE2 syntax keeps a pattern portable to Go; it does not make it linear in JavaScript, so a pattern also avoids nested
  quantifiers over overlapping input. `scripts/check-regex.ts` checks every pattern against Go's `regexp/syntax`.

## Asynchronous code

- Every promise is awaited, returned, or explicitly ignored with `void` and a reason; the gate checks this.

## Tests

- `node:test` and `node:assert/strict` (ADR 0002). What can be a pure function over text or values is one and carries
  the tests, fed from fixtures in the repository.
- Tests never read or write the real sites or the production checkout, never use the network, and leave `TMPDIR` empty.

## Comments and documents

- A comment says what the code cannot: a contract, a limit, a reason. It does not retell the code.
- A document says each thing once and points to where the rest is.
- Comments and Markdown wrap at 120 characters (table rows excepted).

## Reference code

Chosen after the first reviews; until then the nearest existing code that follows this file.

## Gate (`check.sh`)

`tsc --noEmit` passes; `oxlint` reports nothing; `oxfmt` finds nothing to change; `scripts/check-width.ts` finds no
Markdown line outside tables and code blocks and no comment-only line longer than 120 characters;
`scripts/check-html.ts` finds, in the code that writes what a build outputs or serves (in `packages/hadley`: `case`,
`lib`, `index.ts`, `hadley.ts`, `addons/editor`; tests aside), no attribute value written by interpolation and no
template literal as a `.replace` or `.replaceAll` replacement; HTML goes through `case/html.ts`, XML and SVG (the
sitemap, the feed, the og images) through `lib/xml.ts`; `scripts/check-regex.ts` finds every regular expression a
literal in RE2 syntax; `scripts/check-writes.ts` finds file-system writes only in the modules on its list, each listed
with what it writes (a build claims its files in `lib/output.ts` first); `scripts/check-templates.ts` compiles every
template and partial under `sites/*/theme/templates` and finds no `{@raw}` the build would refuse (without sites, it
checks nothing); `scripts/check-content.ts` finds the starters' content and the documentation (`docs/`, `README.md`)
in canonical Markanto, with front matter in LIMA; `scripts/check-links.ts` finds every relative link of the
documentation leading to a file git tracks, and every anchor naming a heading as GitHub and hadley both name it; the
tests pass under `bun test` and under `node --test` (ADR 0002), and those that use `TMPDIR` leave
it empty (a test that writes elsewhere is not caught); `gitleaks` finds no secret in the history or in what is staged,
but for the examples `.gitleaks.toml` names. The tools are pinned in `package.json` (ADR 0003), gitleaks in `check.sh`.
