import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultLanguageOf, fieldSchema, highlightingThemes, readConfig, readThemeSettings } from '../site-config.ts'

// The language of a site's pages is config.lima's to say; hadley does not assume one.

describe('defaultLanguageOf', () => {
  it('reads site.default.language', () => {
    assert.equal(defaultLanguageOf({ site: { default: { language: 'en' } } }), 'en')
  })

  it('stops with a message when config.lima does not name it', () => {
    for (const config of [{}, { site: {} }, { site: { default: {} } }, { site: { default: { language: '' } } }])
      assert.throws(() => defaultLanguageOf(config), /site\.default\.language is missing/)
  })
})

// The settings of the theme: theme/theme.lima names them, with their values and defaults; config.lima sets them.

describe('readThemeSettings', () => {
  const dirs: string[] = []
  after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  const site = (themeLima?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'hadley-theme-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'theme'))
    if (themeLima !== undefined) writeFileSync(join(dir, 'theme', 'theme.lima'), themeLima)
    return dir
  }
  const HEMS = `settings:
  colorScheme:
    allowed: [auto, light, dark]
    defaultValue: auto
  colorToggle:
    allowed: [true, false]
    defaultValue: false
`

  it('gives every setting, from config.lima or its default', async () => {
    assert.deepEqual(await readThemeSettings(site(HEMS), {}), { colorScheme: 'auto', colorToggle: false })
    assert.deepEqual(await readThemeSettings(site(HEMS), { theme: { colorScheme: 'dark' } }), {
      colorScheme: 'dark',
      colorToggle: false,
    })
  })

  it('has none for a theme without theme.lima', async () => {
    assert.equal(await readThemeSettings(site(), {}), undefined)
  })

  it('stops for a setting the theme does not have, or a value it does not allow', async () => {
    await assert.rejects(
      readThemeSettings(site(HEMS), { theme: { colorSchme: 'dark' } }),
      /config\.lima: theme\.colorSchme is not a setting of the theme \(.*theme\.lima: colorScheme, colorToggle\)/,
    )
    await assert.rejects(
      readThemeSettings(site(HEMS), { theme: { colorScheme: 'sepia' } }),
      /config\.lima: theme\.colorScheme is sepia, and the theme allows auto, light, dark/,
    )
    await assert.rejects(readThemeSettings(site(), { theme: { colorScheme: 'dark' } }), /the theme has none/)
    for (const theme of ['hems', 1, null, ['dark']])
      await assert.rejects(readThemeSettings(site(HEMS), { theme }), /theme holds the settings of the theme/)
  })

  it('stops for a theme.lima without settings or defaults', async () => {
    await assert.rejects(readThemeSettings(site('name: hems\n'), {}), /settings is missing/)
    await assert.rejects(
      readThemeSettings(site('settings:\n  colorScheme:\n    allowed: [a]\n'), {}),
      /has no defaultValue/,
    )
    await assert.rejects(
      readThemeSettings(site('settings:\n  colorScheme:\n    allowed: [a]\n    defaultValue: b\n'), {}),
      /defaultValue b is not one of its allowed values/,
    )
  })
})

describe('highlightingThemes', () => {
  it('reads one theme, or a light and a dark one', () => {
    assert.equal(highlightingThemes({ highlighting: { theme: 'nord' } }), 'nord')
    assert.deepEqual(highlightingThemes({ highlighting: { light: 'github-light', dark: 'github-dark' } }), {
      light: 'github-light',
      dark: 'github-dark',
    })
  })

  it('has none when config.lima has no highlighting', () => {
    assert.equal(highlightingThemes({}), undefined)
  })

  it('stops for anything else', () => {
    for (const highlighting of [
      null,
      'nord',
      {},
      { light: 'a' },
      { theme: 'a', dark: 'b' },
      { theme: 'a', style: 'b' },
    ])
      assert.throws(() => highlightingThemes({ highlighting }), /highlighting has theme, or light and dark/)
  })
})

// review 2026-10-29 (documentation): `rss: enabled: "yes"` left the feed off without a word

describe('the switches of config.lima', () => {
  const dirs: string[] = []
  after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  const read = (lima: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'hadley-switches-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'config.lima'), lima)
    return readConfig(dir, {})
  }

  it('are true or false', async () => {
    const config = await read(
      'rss:\n  enabled: true\nsearch:\n  enabled: false\nmarkdown:\n  enabled: true\nog:\n  design: plain\n',
    )
    assert.equal(config.rss.enabled, true)
    assert.equal(config.search.enabled, false)
    assert.equal(config.markdown.enabled, true)
  })

  it('stop the build with any other value', async () => {
    for (const [lima, message] of [
      ['rss:\n  enabled: yes\n', /rss\.enabled is true or false, not yes/],
      ['search:\n  enabled: 1\n', /search\.enabled is true or false, not 1/],
      ['comments:\n  enabled: "true"\n', /comments\.enabled is true or false, not true/],
      ['markdown:\n  enabled: yes\n', /markdown\.enabled is true or false, not yes/],
      ['typography: true\n', /typography is a block with enabled: true or false/],
      ['og:\n  - enabled\n', /og is a block with enabled: true or false/],
    ] as const)
      await assert.rejects(read(lima), message)
  })
})

// 2026-10-29: two fields could claim one name, and a name could be another field's, both without a word

describe('the other names of a field (metadata.<field>.aliases)', () => {
  it('name the field, also one of hadley’s, in gendered and other languages', async () => {
    const schema = await fieldSchema({
      metadata: { author: { aliases: ['autor', 'autorin', 'autor:in', 'autor*in'] }, mood: { aliases: ['stimmung'] } },
    })
    assert.deepEqual(
      { ...schema.aliases },
      {
        autor: 'author',
        autorin: 'author',
        'autor:in': 'author',
        'autor*in': 'author',
        stimmung: 'mood',
      },
    )
  })

  it('stop the build when they are not one name of one field', async () => {
    for (const [metadata, message] of [
      [{ author: { aliases: ['autor'] }, editor: { aliases: ['autor'] } }, /autor is another name of both author and/],
      [{ title: { aliases: ['description'] } }, /description, another name of title, is the name of a field itself/],
      [{ title: { aliases: ['status'] } }, /status, another name of title, is the name of a field itself/],
      [{ mood: {}, title: { aliases: ['mood'] } }, /mood, another name of title, is the name of a field itself/],
      [{ title: { aliases: 'titel' } }, /metadata\.title\.aliases is a list of names/],
      [{ title: { aliases: [1] } }, /metadata\.title\.aliases holds names, not 1/],
    ] as const)
      await assert.rejects(fieldSchema({ metadata }), message)
  })

  it('counts names in their composed form', async () => {
    const schema = await fieldSchema({
      metadata: { 'gro\u0308ße': { aliases: ['pru\u0308fer'] } },
    })
    assert.deepEqual({ ...schema.aliases }, { prüfer: 'größe' })
    assert.ok(schema.declared.has('größe'))
    await assert.rejects(
      fieldSchema({ metadata: { größe: {}, 'gro\u0308ße': {} } }),
      /metadata\.größe is declared twice/,
    )
  })
})
