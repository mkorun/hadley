# ADR 0004: golang.org/x/text for Unicode normalization in the comments service

Status: accepted by the human, 2026-10-27.

Context: the Go comments service (`services/forms/`) must clean a comment's name and text as the service it replaces
does, which normalizes both to Unicode NFC first (`services/forms/CONTRACT.md`, C7). Go's standard library has no
importable normalization: Go 1.27 carries `golang.org/x/text/unicode/norm` only as a vendored copy for its own use.
`docs/go.md` allows the standard library only, any other module after an ADR.

Decision: the service imports `golang.org/x/text/unicode/norm`, for NFC and nothing else, at a version pinned in
`services/forms/go.mod`.

Reasons:

- `golang.org/x/text` is maintained by the Go project, and the standard library vendors this very package for its own
  use.
- Normalization needs the Unicode tables and composition rules; writing them again would be thousands of lines that
  only lag behind Unicode.
- Leaving NFC out would change the stored text for a client that sends decomposed characters, which the contract does
  not allow; the widget normalizes too, but the service cannot rely on its clients.

Costs accepted: one module outside the standard library (its own `go.mod` names `golang.org/x/tools`, `x/mod` and
`x/sync` for its tooling; they are not built into the service), and its updates, which `govulncheck` watches.

Revisit if: the standard library offers normalization itself.
