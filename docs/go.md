# Go in hadley

Go is used for the comments service (`services/forms/`) and the program of a release (`services/launcher/`). The base
is the [Google Go Style Guide](https://google.github.io/styleguide/go/): the
[guide](https://google.github.io/styleguide/go/guide) (normative), the
[decisions](https://google.github.io/styleguide/go/decisions) and the
[best practices](https://google.github.io/styleguide/go/best-practices); it ranks clarity, simplicity, concision,
maintainability and consistency, in that order. For a single topic with its own page on
[go.dev/doc](https://go.dev/doc/) (doc comments, module layout), that page comes first. This file only adds what hadley
decided on top of it.

## Contract

- The service is a drop-in replacement for the TypeScript service it replaces. Its specification is the written
  contract of that service plus a list of deliberate deviations; behaviour changes start there.
- Recorded requests and responses of the TypeScript service are the reference for the tests.

## Structure

- `cmd/` only wires: reading the environment into values, starting the listener, exit codes. Packages below never
  import it, and shared types live in the package that uses them, not in a helper package that only breaks an import
  cycle.
- A value from outside is checked once, at the boundary where it enters: the environment at startup, a request body in
  its handler. Code after that trusts the value.
- An error gets context once per layer.
- What can be a pure function over bytes or values is one, and carries the tests, fed from `testdata/`; the code that
  touches the network or the file system stays thin.

## Dependencies

- The standard library only; any other module needs an ADR first. The Go version is pinned in `go.mod`.

## Comments and documents

- A comment says what the code cannot: a contract, a limit, a reason. It does not retell the code or repeat the
  specification.
- Comments and Markdown wrap at 120 characters (table rows excepted); code is not wrapped for length alone (ADR 0003).

## Reference code

Chosen after the first reviews.

## Gate (`check.sh`, once the service exists)

`gofmt -l` and `go fix -diff` print nothing; `go vet`, `staticcheck` and `go test -race` pass; `govulncheck` finds
nothing; the tests leave `TMPDIR` empty; no comment-only line is longer than 120 characters. The tools are pinned in a
module file of their own (`tools.mod`) and run with `go tool -modfile=tools.mod`.
