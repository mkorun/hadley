# AGENTS.md

This folder is a website made with [hadley](https://hadley.sh), a static site generator. These notes are for a coding
agent working here. They belong to the site: change them as you like.

## Read what the task needs

- **hadley:** https://hadley.sh/llms.txt lists its documentation. For any change to content, start with "A site"
  (folders, bundles, languages) and "Content" (front matter, titles, pictures, links between pages).
- **The text of a page** is [Markanto](https://hadley.sh/docs/markanto/): Markdown as you know it, with a few things
  more and a few forms less. Look a form up there before you rely on it.
- **Front matter and `config.lima`** are [Lima](https://hadley.sh/docs/lima/), the part of YAML that front matter
  needs; it leaves out what front matter does not, such as anchors and tags.
- **The theme** (`theme/`): its templates are [galley](https://github.com/mkorun/galley#readme). Read it only when the
  task is the theme.

## The site

- `content/`: each page is a bundle, a folder `[id]/` holding `id.md`, the pictures and files it names, and its other
  languages in folders such as `de/`.
- `config.lima`: what the site is and how it is built. A field may go by another name here (`aliases`); read it
  before you write front matter.
- `theme/`: the site's own theme, part of the site and not a dependency.
- `.hadley/`: what hadley builds and caches. Never edit it.

## Working here

- `hadley dev` serves the site at http://localhost:8000 and rebuilds it on every save.
- `hadley deploy --build` writes the site to publish into `.hadley/publish/`.
- A page's title is either its front matter's `title` or a `#` heading as its first block, never both; a bold line
  right after that heading is its subtitle.
- Every change to a page becomes a version the author can compare and take back. Keep changes small and clear.
- Publishing, deleting and anything that leaves this machine are the author's decision: ask first.
