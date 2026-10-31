# ADR 0001: Bun and Node.js, from the same TypeScript sources

Status: accepted by the human, 2026-10-23. Migration: in progress. A checkout runs from its sources on Bun and on
Node.js ≥ 24; the six sites build byte for byte the same on both (2026-10-27). `scripts/pack.ts` builds the package to
publish in `dist/`; installed from its tarball with npm, it builds the sites the same. The tests run on both runtimes
(ADR 0002).

Context: hadley was developed on Node.js, moved to Bun in spring 2026 and ran on Bun only. Most people who use static
site generators run Node.js. Node.js 24 runs TypeScript directly by stripping types, so this is no longer a Bun-only
ability. The core uses no `Bun.*` API; Bun-only code is limited to the comments service (being replaced by Go), one
`Bun.spawnSync` in the comments CLI and the tests (`bun:test`, see ADR 0002).

Decision: hadley runs on Bun and on Node.js ≥ 24 from the same sources.

- Sources use only TypeScript syntax that can be erased (`erasableSyntaxOnly`), mark type-only imports
  (`verbatimModuleSyntax`) and import relative modules with their `.ts` extension.
- Runtime-specific APIs stay behind one module per concern; the rest uses `node:` modules.
- The published package contains JavaScript: `tsc` compiles the sources to `dist/` with
  `rewriteRelativeImportExtensions`. That is the only build step, and only for publishing; a checkout runs from its
  sources.
- Bun remains the runtime for development.

Reasons (probes of 2026-10-23):

- Node.js 24.18 refuses TypeScript inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) while Bun runs
  it; a published package therefore has to contain JavaScript.
- With TypeScript 7.0.2, one set of `.ts` sources ran unchanged on Node.js and Bun, and `tsc` emitted `.js` files with
  rewritten imports plus declarations that ran on Node.js.
- `node hadley.ts` on Node.js 24.18 stopped only at module resolution (35 relative imports without or with a `.js`
  extension), not at any TypeScript syntax: the code uses no `enum`, `namespace` or parameter properties.

Costs accepted: CI runs everything twice; the import paths have to change once; a publish needs a compile step.

Revisit if: Node.js runs TypeScript from `node_modules`, or keeping both runtimes costs more than the reach it buys.
