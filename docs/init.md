# hadley init

```
hadley init [dir] [--language <languages>] [--theme <theme>] [--blank]
```

Makes a new site in `dir`, by default the current directory, which must be empty or not exist: a theme as its
`theme/`, by default hems, with the theme's own starter, the sample site made for it (`starters/<theme>/`). hems brings
Feather Cat, a small blog with articles, a series and pictures to read and make one's own; punch brings Noa Varela, a
personal site with a few posts. `--blank` takes the starter `blank` instead, which goes with any theme: a home page, an
imprint, a feed page and a 404 page, and nothing to delete. A theme hadley does not bring stops it, naming those it
does. The blocks of the theme's `starter:` (`theme.lima`) go into the new `config.lima`.

`--language` names the site's languages, its default first: `de` for German alone, `de,en` for German with English.
`all` stands for all the starter is written in, `en,de,fr,es,it` for every one. Without it the site is English. A
language the starter is not written in stops it, naming those it is.

A starter keeps each language's text under its name: its pages in the bundles' language folders (English in the
bundle itself), its values in blocks or keys named after it in `config.lima` and the person file; the blocks of
`site:` in its `config.lima` are the languages it is written in. `init` leaves out the languages not chosen and moves
the default language's pages into the bundles, English ones into `en/` if English is not the default. A `urlPath`
loses the prefix of a language that becomes the default (`/de/` is `/`) and gains `/en/` where English is no longer
the default.
