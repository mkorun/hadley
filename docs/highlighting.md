# Code highlighting

hadley highlights a code block that names its language with [Shiki](https://shiki.style), in the theme or themes
`config.lima` names. Without them, a code block that names its language stops the build.

```lima
highlighting:
  theme: nord
```

or, for pages that are light and dark:

```lima
highlighting:
  light: github-light
  dark: github-dark-dimmed
```

Each is one of [Shiki's themes](https://shiki.style/themes), or one the site's theme brings:
`theme/highlighting/<name>.json`, a Shiki theme (TextMate JSON) named as its file is, of the type `light` or `dark`.
hems brings `hems-light` and `hems-dark`. hadley writes the colors to `/assets/css/syntax-highlighting.css`, also for
a site without code, so that a theme can link it; `hasCode` tells a template whether the page has a code block that
names its language, and hems and punch link the file only then. With a light and a dark theme, a color is
`light-dark(<light>, <dark>)`: it follows the `color-scheme` of the page, which the site's theme sets (hems does). A
font style, weight or underline that the two themes set differently follows the reader's system instead
(`prefers-color-scheme`).
