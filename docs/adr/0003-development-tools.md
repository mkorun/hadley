# ADR 0003: Development tools and style

Status: accepted by the human, 2026-10-23.

Context: the compiler is not pinned (`bunx tsc` fetched TypeScript 7.0.2, the native implementation). Nothing checks
that promises are handled. A formatter configuration exists (`.prettierrc.json`) but is not applied: 48 of 53
TypeScript files differ from it, the core is indented with tabs and the add-ons with spaces. TypeScript 7 ships no
programmatic compiler API, so linters built on that API cannot use it.

Decision:

- **Style guide:** the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide) is the base;
  `docs/typescript.md` adds hadley's decisions and names every deviation.
- **Compiler:** `typescript` 7.0.2, pinned exactly; `tsc --noEmit` in the gate.
- **Lint:** `oxlint` with `oxlint-tsgolint` (type-aware rules on the TypeScript 7 checker), pinned exactly. The rules
  start with `no-floating-promises` and `no-misused-promises`; more only when a problem shows they are missing.
- **Format:** `oxfmt`, pinned exactly: two spaces, no semicolons, single quotes, trailing commas, line width 120.
- **Line width:** 120 for code (the formatter's width), comments and Markdown (tables excepted). In Go `gofmt` does
  not wrap code, so there 120 applies to comments and Markdown only.

Reasons (probes and sources of 2026-10-23):

- `typescript-eslint` 8.72 supports TypeScript `>=4.8.4 <6.1.0` only; type-aware ESLint would pin hadley to
  TypeScript 6. The same holds for the ESLint-based StandardJS family (`standard` still on ESLint 8, `ts-standard`
  last released 2023, `neostandard` on ESLint 9).
- tsgolint is stable since v7 (September 2026), runs on typescript-go and follows the compiler's version. On hadley's
  code it reported 9 unhandled and 5 misused promises.
- Biome 2.6 reported the same 9 unhandled promises but none of the 5 misused ones; its promise rules are still in the
  `nursery` group and rest on its own partial type inference.
- oxfmt is a beta that passes Prettier's JavaScript and TypeScript conformance tests and reads Prettier's
  configuration format, so the choice can be reversed without reformatting. It belongs to the same project as oxlint.
- Two spaces are the default of the formatters and the Google guide. One width of 120 for code, comments and
  Markdown; the 130 of d0 only ever limited comments, because `gofmt` does not wrap code.

Costs accepted: four tool packages; oxlint finds `tsgolint` only in the project's own `node_modules`; oxfmt is still
before 1.0; one large formatting commit.

Revisit if: oxfmt changes its output in a way Prettier would not, or Biome's promise rules leave `nursery` and find what
tsgolint finds.
