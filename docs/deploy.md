# Deploying

```sh
hadley deploy --build
```

builds the site for publishing into `.hadley/publish/`:

|  |  |
| --- | --- |
| `index.html`, `<path>/index.html` | every published page, under its URL path; the error pages under `errors/`: `errors/404/index.html`, `de/errors/404/index.html` |
| `404.html`, `de/404.html` | each language's 404 page again, for a host that looks for that name ("Static hosts") |
| the files of the pages | the pictures in their widths and formats, the files the pages name, the og images |
| `assets/…` | the theme's files; its stylesheets and scripts minified and named by the hash of their bytes |
| `feed.xml`, `de/feed.xml` | the feeds, when `rss` is on |
| `pagefind/` | the search index, when `search` is on |
| `sitemap.xml`, `llms.txt` | the published pages that search engines and language models may read |
| `<path>/index.html.md` | each page in `llms.txt` as Markdown, when `markdown` is on (below) |
| the theme's `static/` | at the root: `favicon.svg`, `robots.txt` and the like |

## Markdown for language models

`llms.txt` lists every published page except home and error pages, unless `sitemap: false` leaves it out. With
`markdown: enabled: true` in `config.lima`, each of them also gets a Markdown twin, which `llms.txt` links instead of
the HTML page: the twin of `/notes/example/` is `/notes/example/index.html.md`. `markdown: false` in a page's front
matter leaves its twin out, and `llms.txt` links its HTML page.

A twin contains public front matter — `title`, `description`, `url`, `language`, `published`, `updated`, `author` and
`tags`, where present — followed by its title and canonical Markanto content. Its links and files use their absolute
URLs on the site's origin; external and fragment-only destinations stay as written.

Beside it, `.hadley/meta.json` holds the titles and paths of the articles, for the comments service's notifications
(comments.md), and is not published. `hadley deploy` without `--build` serves the same build at
<http://localhost:8000> first.

## The server

The folder is the whole site: copy it to any web server, for example with rsync:

```sh
rsync -a --delete .hadley/publish/ server:/var/www/example.org/
```

The server should:

- answer a missing page with the 404 page of the language its path begins with, `de/errors/404/index.html` for
  `/de/…`, else with `errors/404/index.html`, and status 404;
- let a browser keep `/assets/css/*` and `/assets/js/*` for good, as their names change with their bytes, and
  revalidate everything else;
- set a Content Security Policy. hadley writes no script that runs and no style into a page; the policy is what
  keeps one out ([AGENTS.md](../AGENTS.md), "Security"). The page's JSON-LD, `<script type="application/ld+json">`, is
  data, which a browser does not run and the policy does not govern. The search runs Pagefind's WebAssembly, which
  needs `'wasm-unsafe-eval'`;
- answer `*.svg` with `Content-Security-Policy: sandbox` as well: an SVG file of a bundle is published as it is, and
  sandboxed, script in it does not run when a visitor opens it. As a picture in a page it shows as before.

With [Caddy](https://caddyserver.com):

```caddy
example.org {
    root * /var/www/example.org
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Content-Security-Policy   "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; media-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
    }

    @svg path *.svg
    header @svg +Content-Security-Policy "sandbox"

    @fingerprinted path /assets/css/* /assets/js/*
    handle @fingerprinted {
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    handle {
        header Cache-Control "no-cache"
        file_server
    }

    handle_errors {
        @shown expression {err.status_code} in [404, 503]
        handle @shown {
            @unavailable expression {err.status_code} == 503
            header @unavailable Retry-After 3600
            # the error page of the language the path begins with, else the default language's
            @language path_regexp language ^/([^/]+)/
            handle @language {
                try_files /{re.language.1}/errors/{err.status_code}/index.html /errors/{err.status_code}/index.html
                file_server
            }
            handle {
                rewrite * /errors/{err.status_code}/index.html
                file_server
            }
        }
    }
}
```

The error pages answer 503 as well, for a site under maintenance ("Maintenance").

A page that embeds another site's video needs that site in `frame-src`; one that shows pictures from elsewhere, in
`img-src`.

## Static hosts

A host that serves the folder as it is, with no rules of its own, answers a missing page with a file `404.html`:

- GitHub Pages with the one at the root, in the default language, for every path;
- Cloudflare Pages with the nearest one, `de/404.html` for `/de/…`;
- Netlify with the one at the root, and with a language's own by a line for it in `_redirects`, which the theme's
  `static/` puts at the root:

  ```text
  /de/*  /de/404.html  404
  ```

## Maintenance

With `maintenance: enabled: true` in config.lima, `hadley deploy --build` makes only the error page `@errors/[503]`,
in each of its languages, with the theme's files and its own: at `errors/503/index.html`, and in each language's place
of its home and its `404.html` as well (`index.html`, `de/index.html`, `404.html`, `de/404.html`), and beside them an
empty file `.maintenance`. `hadley deploy` shows that build first, as it will be online.

A server that knows nothing of it, and a static host, show the page at every address, as `404.html` with status 404;
for a few days that does no harm, but a search engine may take pages that answer 404 for long out of its index. Caddy
answers every page with it, and status 503, while `.maintenance` is there:

```caddy
    @maintenance {
        file /.maintenance
        not path /assets/* /errors/* /favicon.* /robots.txt
        not path_regexp ^/[^/]+/errors/
    }
    handle @maintenance {
        error 503
    }
```

The block goes into the site's block above, before its other `handle` blocks; its `handle_errors` shows the page.
The error pages stay out of it, `/errors/` and `/de/errors/`, as each language's page has its pictures there. The
next build without `maintenance` takes `.maintenance` away again (`rsync --delete`).

## Comments

The comments service, `hadley-forms`, runs beside the web server, which passes it `/api/comment/` and
`/admin/comments` ([comments.md](comments.md), "In production"):

```caddyfile
    handle /api/comment/* {
        reverse_proxy 127.0.0.1:9001
    }
    handle /admin/comments {
        reverse_proxy 127.0.0.1:9001
    }
```

The service counts a visitor by the address in `X-Forwarded-For`. Caddy sets that header itself; another server must
replace what a visitor sent, not add to it.
