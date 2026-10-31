# AGENTS.md

Rules for every agent (and human) working in this repository. `CLAUDE.md` imports this file.

## What hadley is

hadley is a static site generator with its own parts: LIMA for metadata, Markanto (through `case`) for content, galley
for templates, quad for HTML. It runs on Bun and Node.js. The whole system stays small enough to be understood at once;
that is the design, not a phase. So:

1. **Understandable as a whole.** A simple rule that can be explained beats a clever one that cannot.
2. **Explicit structure over hidden magic.** Folders and files say what they are; nothing works by an unwritten
   convention.
3. **Own where it matters, delegate where the best exists.** Content, templates and formatting are hadley's own; Vite,
   sharp, Shiki and Pagefind do what they do best.
4. **Ownership over convenience.** A theme is a starting point that becomes the site's own, not a dependency.

## Principles

- **Documentation first, and short.** A change of behaviour starts in the documentation of the part it changes; the
  documentation says what, not why.
- **Read before you build.** The history (`git log`; the local graft reaches back into the private predecessor) and
  the code often solved a problem already. Unknowns are answered by a small probe before the work, not inside it.
- **One place per fact.** Nothing is written twice across code, configuration and documentation; the others point to it.
- **Never guess.** An unknown format, a missing field or a failed call stops with a clear message; no silent fallback,
  no default that hides a fault.
- **Verify before you report.** A statement about code, a build or a site is checked live before it is passed on.
- **When fixes keep growing in one place, the design is wrong.** Stop patching, step back, and prefer the redesign that
  deletes code.
- **What a tool can check belongs in the gate**, not in prose. Every review also asks what can go.
- **Readable code before line count.** A budget cuts scope, never clarity.

## Production stays untouched

`main` is what the human deploys: their deploy script builds the sites with it.

- The sites (`sites/<domain>`, symlinks to the human's site directories) are read-only for agents: no edits, and no
  builds into their `.hadley/` directories. A change a site needs is a patch, applied when the human says so.
- Agents work on a branch in a worktree; it reaches `main` by `git merge --ff-only` when the human says so. A fix of a
  fault needs no word: once the gate passes, and `compare-builds` where output can change, the agent merges it and then
  tells the human. New behaviour, documentation-of-record texts and intended differences of output still wait for them.
- Every change that can affect output is checked with `scripts/compare-builds.ts --ref <the main checkout>`, which
  builds on copies. An intended difference is named in the commit message; only the human accepts it.
- The comments service in production (`../addons/forms/server`) is not changed. Its Go replacement in `services/forms/`
  follows the written contract and must be a drop-in replacement.
- Agents never deploy and never push; the human does.

## How we work

- Chat with the human is German; all repository content is English. User-facing translations (for example the German
  interface of the editor) and deliberately German test data are content, not exceptions to this rule.
- Commits are authored as `mko`. A commit an agent prepared keeps its trailers: `Co-Authored-By` and, from Claude Code,
  `Claude-Session`.
- Human-owned files: `.gitignore`, `package.json`, `bun.lock`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`, `LICENSE`, and
  in `services/forms/` `go.mod`, `go.sum`, `tools.mod`, `tools.sum`. Agents never change them; they propose a diff.
- Principle, documentation-of-record and agent-rule texts are shown to the human before they are committed.
- The supervisor builds in conversation with the human or briefs a worker; a brief says what must be true, not how.
  The human decides when a review runs; the supervisor proposes one for a new command, for code that touches security
  (the comments service, URL handling, the editor's write path) and before a milestone. A review is by a different
  provider than the author; workers report what they could not verify.
- `./check.sh` passes before every commit. Run it on its own and check its exit status; never pipe or chain it.

## Security

- Never print, log or commit credential material. Never read `.env` files of the comments service.
- Never read the human's login files (`~/.claude`, `~/.claude.json`, `~/.codex/auth.json`, `~/.gemini`,
  `~/.local/share/opencode/auth.json`).
- Content — the Markdown and front matter of a bundle — is untrusted. hadley writes it escaped, never as markup: a
  template writes HTML only from `html.*` and from `t.*`, the theme's own texts, and the build refuses any other
  `{@raw}`; `html.*` is HTML hadley wrote, except `html.comments`, the bundle's `_comments.html`, which the comments
  tool (`packages/hadley/addons/forms`) writes with what visitors wrote escaped, and which is trusted like that tool.
  Content cannot make hadley read outside its bundle or write outside the output directory; every file and page it names
  is built or fails a published page, and so does a destination a page may not have (a scheme it may not use, another
  host without one), and what a template writes into a URL attribute must leave it relative or with http, https, mailto
  or tel (galley, `G5001`). Script is kept out by the Content Security Policy the site's server sets, which the browser
  enforces; hadley does not set one. Trusted like code: `config.lima`, themes and templates, and the filesystem layout
  of the site (a symlink is the owner's own decision). Keep that boundary and its tests.
- External programs run with argument arrays, never through a shell string; every external call has a timeout.

## Languages

- TypeScript: `docs/typescript.md`. Runtimes: `docs/adr/0001-runtimes.md`; tests: `docs/adr/0002-tests.md`. Each ADR
  says how far its migration is.
- Go (the comments service): `docs/go.md`.
