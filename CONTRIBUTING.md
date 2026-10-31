# Contributing

Thank you for helping. hadley is meant to stay small enough to be understood as a whole; [AGENTS.md](AGENTS.md) says
what that asks of every change, from people and from agents alike. Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md); a vulnerability is reported as [SECURITY.md](SECURITY.md) says, not in an issue.

## Before you start

An issue first, for anything larger than a fix: it saves work on a change that would not fit. A change of behaviour
starts in the documentation of the part it changes (`docs/`); the documentation says what, not why.

## Set up

```sh
git clone https://github.com/mkorun/hadley.git
cd hadley
bun install
```

[Bun](https://bun.sh) 1.4 builds and tests; [mise](https://mise.jdx.dev) gives the gate Go for the comments service,
at the version `services/forms/go.mod` names, and [gitleaks](https://github.com/gitleaks/gitleaks), at the one
`check.sh` names. The gate also needs Node.js 24, `exiftool`, the Noto fonts for og images, and the network for
`govulncheck`; `.github/actions/tools/action.yml` names the versions. `packages/hadley` is the package,
`services/forms` the comments service in Go, `scripts` the tools of the repository.

## The gate

```sh
./check.sh
```

passes before every commit: formatting, types, lint, line width, the HTML and regex rules, the tests under Bun and
Node.js, the comments service, and no secret in the history or in what is staged
([docs/typescript.md](docs/typescript.md), "Gate"). Run it on its own and read its exit status.

A change that can change what a site's build writes is checked against the current `main` with
`bun scripts/compare-builds.ts --ref <a checkout of main> --sites <a folder of sites>`, which builds both on copies and
compares every file. A difference that is meant is named in the commit message.

## Code and commits

- TypeScript as [docs/typescript.md](docs/typescript.md) says, Go as [docs/go.md](docs/go.md) says.
- Everything in the repository is English: code, comments, documentation, commits.
- A commit says what it changes in its first line, and why in its body where that is not plain.
- External programs run with argument arrays, never through a shell, and with a timeout.

## Pull requests

A pull request does one thing, with its tests and its documentation, and passes the gate. Contributions are under the
project's [ISC license](LICENSE).
