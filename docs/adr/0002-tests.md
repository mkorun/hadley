# ADR 0002: Tests with node:test and node:assert

Status: accepted by the human, 2026-10-23. Migration: done (2026-10-27). Every test uses `node:test` and runs under
`bun test` and `node --test`; the gate runs both.

Context: the tests use `bun:test` (`describe`, `it`, `expect`), which Node.js cannot run. Two suites, or a test-only
check on Node.js, would leave half of the supported runtimes (ADR 0001) without the same tests.

Decision: tests import from `node:test` and `node:assert/strict` directly, without an `expect` layer of our own. The
same files run with `bun test` and with `node --test`.

Reasons (probe of 2026-10-23): one file with `describe`, `it`, `beforeEach`, `assert.deepEqual`, `assert.throws` and a
deliberate failure gave the same result on both runners (3 passed, 1 failed). An own `expect` layer would be code whose
behaviour quietly differs from the real `expect`.

Costs accepted: one conversion of 20 files with about 490 assertions. `toEqual` ignores properties whose value is
`undefined` and `assert.deepEqual` does not, so some tests need a look of their own; `spyOn` becomes `mock.method`;
`test.each` becomes a loop.

Revisit if: one of the runners stops supporting `node:test`.
