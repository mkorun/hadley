# hadley init

```
hadley init [dir] [--language <languages>] [--theme <theme>] [--blank] [--git]
```

Makes a new site in `dir`, by default the current directory, which must be empty or not exist: a theme as its
`theme/`, by default hems, with the theme's own starter, the sample site made for it (`starters/<theme>/`). hems brings
Feather Cat, a small blog with articles, a series and pictures to read and make one's own; punch brings Noa Varela, a
personal site with a few posts. `--blank` takes the starter `blank` instead, which goes with any theme: a home page, an
imprint, a feed page and a 404 page, and nothing to delete. A theme hadley does not bring stops it, naming those it
does. The blocks of the theme's `starter:` (`theme.lima`) go into the new `config.lima`, and the year `init` runs in
as `site.since`, the first year of the copyright line ([config.md](config.md)).

`init` also writes four files for working on the site:

- `AGENTS.md`: notes for a coding agent, naming the site's folders, its commands and which documentation to read for
  what. Codex reads it, and so does the agent the editor's chat starts.
- `CLAUDE.md`: imports `AGENTS.md` for Claude Code.
- `.gitignore`: keeps `.hadley/` out of git, the folder of what hadley builds and caches and of the secrets of the
  local comments service.
- `.gitattributes`: makes git check out text with `\n` on every system ([platforms.md](platforms.md)).

They belong to the site, as its theme does: hadley writes them once and never again.

`--git` also makes the site a git repository, with all `init` wrote as its first commit, "hadley init", on the branch
git starts with:

- Without git on the machine, `init` stops before it writes anything.
- In a directory inside a repository already, `init` makes the site but no repository of its own, and names the one
  around it.
- While git knows no name and email, the commit fails: the repository is there with the files added, `init` shows what
  git said, and `git commit -m "hadley init"` makes the commit once git knows them.

`--language` names the site's languages, its default first: `de` for German alone, `de,en` for German with English.
`all` stands for all the starter is written in, `en,de,fr,es,it` for every one. Without it the site is English. A
language the starter is not written in stops it, naming those it is.

A starter keeps each language's text under its name: its pages in the bundles' language folders (English in the
bundle itself), its values in blocks or keys named after it in `config.lima` and the person file; the blocks of
`site:` in its `config.lima` are the languages it is written in. `init` leaves out the languages not chosen and moves
the default language's pages into the bundles, English ones into `en/` if English is not the default. A `urlPath`
loses the prefix of a language that becomes the default (`/de/` is `/`) and gains `/en/` where English is no longer
the default.
