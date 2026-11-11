import { after, before, describe, it } from 'node:test'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../index.ts'
import {
  AGENTS,
  BLANK,
  GITATTRIBUTES,
  GITIGNORE,
  STARTERS,
  THEMES,
  configFor,
  init,
  namesOf,
  pageFor,
  parseLanguages,
  starterBlocks,
  starterLanguages,
  starterOf,
  targetOf,
  withoutLanguages,
} from '../init.ts'
import { slashed } from '../platform.ts'

// hadley init (docs/init.md): a starter with a theme, in the languages named.

const starters = await namesOf(STARTERS)
const themes = await namesOf(THEMES)
const written = Object.fromEntries(
  await Promise.all(starters.map(async (starter) => [starter, await starterLanguages(starter)] as const)),
)

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-init-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the languages of hadley init', () => {
  it('are English alone without --language, all with all, and those named, the default first', () => {
    const five = ['en', 'de', 'fr', 'es', 'it']
    assert.deepEqual(written.hems, five)
    assert.deepEqual(parseLanguages(undefined, five), ['en'])
    assert.deepEqual(parseLanguages('all', five), five)
    assert.deepEqual(parseLanguages('de, en', five), ['de', 'en'])
    assert.throws(() => parseLanguages('de,nl', five), /written in en, de, fr, es, it, not "nl"/)
    assert.throws(() => parseLanguages('de,de', five), /de is named twice/)
  })

  it("are the language blocks of each starter's config.lima, as its bundles' language folders are", async () => {
    for (const starter of starters) {
      const folders = new Set<string>()
      for (const path of await readdir(join(STARTERS, starter, 'content'), { recursive: true })) {
        const segments = slashed(path).split('/')
        const bundle = segments.findLastIndex((segment) => /^\[.+\]$/.test(segment))
        if (bundle !== -1 && segments.length === bundle + 3) folders.add(segments[bundle + 1]!)
      }
      const others = written[starter]!.filter((language) => language !== 'en')
      assert.deepEqual([...folders].sort(), others.sort(), starter)
    }
  })
})

describe('what hadley init writes', () => {
  it('leaves out the blocks and keys of the languages not named, and keeps the blank line after one', () => {
    const lima = 'site:\n  en:\n    claim: A\n  fr:\n    claim: B\n\n# next\nlabel:\n  en: Essay\n  fr: Essai\n'
    assert.equal(withoutLanguages(lima, ['fr']), 'site:\n  en:\n    claim: A\n\n# next\nlabel:\n  en: Essay\n')
  })

  it("writes the year it runs in as the site's since, after its owner, and stops on a starter without one", () => {
    const lima = 'site:\n  origin: https://example.org\n  owner: $(persons/ada)\n  default:\n    language: en\n'
    assert.equal(
      configFor(lima, ['en'], ['en'], '', 2031),
      'site:\n  origin: https://example.org\n  owner: $(persons/ada)\n  since: 2031  # the first year of the copyright line\n  default:\n    language: en\n',
    )
    assert.throws(
      () => configFor('site:\n  default:\n    language: en\n', ['en'], ['en'], '', 2031),
      /names no site owner/,
    )
  })

  it("takes the blocks of the theme's starter: as top-level Lima", () => {
    const theme =
      'settings:\n  a:\n    defaultValue: 1\n\nstarter:\n  theme:\n    a: 2\n  highlighting:\n    theme: nord\n'
    assert.equal(starterBlocks(theme), 'theme:\n  a: 2\nhighlighting:\n  theme: nord')
    assert.equal(starterBlocks('settings:\n'), '')
  })

  it('moves the prefix of a urlPath with the default language', () => {
    assert.equal(pageFor('---\nurlPath: /de/\n---\n', 'de', 'de'), '---\nurlPath: /\n---\n')
    assert.equal(pageFor('---\nurlPath: /404/\n---\n', 'en', 'de'), '---\nurlPath: /en/404/\n---\n')
    assert.equal(pageFor('---\nurlPath: /fr/\n---\n', 'fr', 'de'), '---\nurlPath: /fr/\n---\n')
  })

  it('puts the pages of the default language into the bundle, English into en/, and leaves images where they are', () => {
    const languages = ['de', 'en']
    assert.deepEqual(targetOf(['pages', '[a]', 'de', 'a.md'], languages, 'de'), {
      segments: ['pages', '[a]', 'a.md'],
      page: 'de',
    })
    assert.deepEqual(targetOf(['pages', '[a]', 'a.md'], languages, 'de'), {
      segments: ['pages', '[a]', 'en', 'a.md'],
      page: 'en',
    })
    assert.deepEqual(targetOf(['pages', '[a]', 'a.png'], languages, 'de'), { segments: ['pages', '[a]', 'a.png'] })
    assert.equal(targetOf(['pages', '[a]', 'fr', 'a.md'], languages, 'de'), null)
  })

  it("refuses a directory that is not empty, a theme hadley does not bring, and another theme's starter", async () => {
    await writeFile(join(dir, 'taken'), '')
    await assert.rejects(init(dir, ['en'], 'hems', 'hems'), /is not empty/)
    await assert.rejects(init(join(dir, 'new'), ['en'], 'nowhere', 'hems'), /hadley brings hems, punch/)
    await assert.rejects(init(join(dir, 'new'), ['en'], 'hems', 'punch'), /the starter punch is not the theme hems's/)
    await assert.rejects(starterOf('nowhere', true), /hadley brings hems, punch/)
  })

  it('writes AGENTS.md for a coding agent, and CLAUDE.md that imports it for Claude Code', async () => {
    const site = join(dir, 'agents')
    await init(site, ['en'], 'hems', BLANK)
    assert.equal(await readFile(join(site, 'AGENTS.md'), 'utf-8'), await readFile(AGENTS, 'utf-8'))
    assert.equal(await readFile(join(site, 'CLAUDE.md'), 'utf-8'), '@AGENTS.md\n')
  })

  it('writes .gitignore, which keeps .hadley/ out of git, and .gitattributes, which checks text out with \\n', async () => {
    const site = join(dir, 'gitfiles')
    assert.equal(await init(site, ['en'], 'hems', BLANK), undefined)
    assert.equal(await readFile(join(site, '.gitignore'), 'utf-8'), await readFile(GITIGNORE, 'utf-8'))
    assert.match(await readFile(join(site, '.gitignore'), 'utf-8'), /^\.hadley\/$/m)
    assert.equal(await readFile(join(site, '.gitattributes'), 'utf-8'), await readFile(GITATTRIBUTES, 'utf-8'))
    assert.match(await readFile(join(site, '.gitattributes'), 'utf-8'), /^\* text=auto eol=lf$/m)
  })

  it('gives a theme its own starter, or the blank one', async () => {
    assert.equal(await starterOf('punch', false), 'punch')
    assert.equal(await starterOf('punch', true), 'blank')
    assert.deepEqual(starters, [BLANK, ...themes])
  })
})

describe('hadley init --git', () => {
  // git as on a machine of its own: no configuration of the human's, an identity only where a test gives one
  const IDENTITY = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']
  async function withGit<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
    const empty = join(dir, 'empty.gitconfig')
    await writeFile(empty, '')
    const given: Record<string, string | undefined> = {
      ...Object.fromEntries(IDENTITY.map((name) => [name, undefined])),
      GIT_CONFIG_GLOBAL: empty,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: undefined,
      ...env,
    }
    const before = Object.fromEntries(Object.keys(given).map((name) => [name, process.env[name]]))
    const set = (values: Record<string, string | undefined>) => {
      for (const [name, value] of Object.entries(values))
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
    set(given)
    try {
      return await run()
    } finally {
      set(before)
    }
  }
  const ada = { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.org' }
  const asCommitter = { GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.org' }
  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', timeout: 60_000 })

  it('makes the site a repository with the new site as its first commit', async () => {
    const site = join(dir, 'git-commit')
    assert.deepEqual(
      await withGit({ ...ada, ...asCommitter }, () => init(site, ['en'], 'hems', BLANK, { git: true })),
      {
        made: 'commit',
      },
    )
    assert.equal(git(site, 'log', '--format=%s').stdout, 'hadley init\n')
    assert.equal(git(site, 'status', '--porcelain').stdout, '')
    const tracked = git(site, 'ls-files').stdout.split('\n')
    assert.ok(tracked.includes('.gitignore') && tracked.includes('config.lima'), tracked.join(' '))
  })

  it('leaves the repository without a commit while git knows no name and email, and passes on what git said', async () => {
    const site = join(dir, 'git-nobody')
    const nobody = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' }
    const made = await withGit(nobody, () => init(site, ['en'], 'hems', BLANK, { git: true }))
    assert.equal(made?.made, 'repository')
    assert.ok(made?.made === 'repository' && made.git !== '')
    assert.notEqual(git(site, 'rev-parse', '--verify', '--quiet', 'HEAD').status, 0)
    assert.match(git(site, 'status', '--porcelain').stdout, /^A {2}config\.lima$/m)
  })

  it('makes no repository inside one, and names the one it is in', async () => {
    const outer = join(dir, 'git-outer')
    await mkdir(outer)
    assert.equal(git(outer, 'init', '--quiet').status, 0)
    const top = git(outer, 'rev-parse', '--show-toplevel').stdout.trim()
    const made = await withGit({}, () => init(join(outer, 'site'), ['en'], 'hems', BLANK, { git: true }))
    assert.deepEqual(made, { made: 'nothing', inside: top })
    // the site's files belong to the repository around it, with no .git of their own
    assert.equal(git(join(outer, 'site'), 'rev-parse', '--show-toplevel').stdout.trim(), top)
  })

  it('stops before it writes anything without git on the machine', async () => {
    const site = join(dir, 'git-none')
    const paths = Object.fromEntries(
      Object.keys(process.env)
        .filter((name) => name.toUpperCase() === 'PATH')
        .map((name) => [name, join(dir, 'no-such-folder')]),
    )
    await withGit(paths, () =>
      assert.rejects(init(site, ['en'], 'hems', BLANK, { git: true }), /--git: there is no git on this machine/),
    )
    assert.equal(await readdir(site).catch(() => 'none'), 'none')
  })
})

// review 2026-10-28 (C.4): every starter in every language as the default, with others, builds for publishing with
// each theme it goes with: its own, and the blank starter with every theme
describe('a site hadley init makes', () => {
  for (const starter of starters) {
    const all = written[starter]!
    const cases = [...all.map((language) => [language]), ...(all.length > 1 ? [all.slice(0, 2).reverse(), all] : [])]
    for (const languages of cases)
      it(`builds from ${starter} in ${languages.join(', ')}`, async () => {
        for (const theme of starter === BLANK ? themes : [starter]) {
          const site = join(dir, `${starter}-${theme}-${languages.join('-')}`)
          await init(site, languages, theme, starter)
          const write = process.stdout.write.bind(process.stdout)
          process.stdout.write = () => true
          try {
            await build(site, 'publish')
          } finally {
            process.stdout.write = write
          }
          const home = await readFile(join(site, '.hadley', 'publish', 'index.html'), 'utf-8')
          assert.ok(home.includes(`© ${new Date().getFullYear()} `), 'the copyright line starts in the year of init')
          assert.ok(home.includes(`<html lang="${languages[0]}"`), `the home page is in ${languages[0]}`)
          const pages = await readdir(join(site, '.hadley', 'publish'))
          for (const other of languages.slice(1)) assert.ok(pages.includes(other), `${other}/ is published`)
        }
      })
  }
})

// review 2026-10-28 (C.5): a page whose template the theme lacks stopped the build over its cover's image config
describe('a page of a site', () => {
  it('stops the build when the theme has no template it names', async () => {
    const site = join(dir, 'no-template')
    await init(site, ['en'], 'hems', 'hems')
    const page = join(site, 'content', 'pages', '[about]', 'about.md')
    await writeFile(page, (await readFile(page, 'utf-8')).replace('title: About', 'title: About\ntemplate: nope'))
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await assert.rejects(
        build(site, 'publish'),
        /about\.md: the theme has no template nope \(templates\/nope\.chase\)/,
      )
    } finally {
      process.stdout.write = write
    }
  })

  // read-whole runs 2026-11-10: a note in hems or punch stopped the build, as neither theme had a note template
  for (const theme of themes)
    it(`builds a note in ${theme}, with its date and the address it points to`, async () => {
      const site = join(dir, `note-${theme}`)
      await init(site, ['en'], theme, BLANK)
      await mkdir(join(site, 'content', 'notes'), { recursive: true })
      const note =
        '---\npublishFrom: 2026-11-10\ndescription: Where hadley lives.\nlink: https://github.com/mkorun/hadley\n---\n'
      await writeFile(join(site, 'content', 'notes', 'source.md'), `${note}# The source\n\nAll of it, in one place.\n`)
      const write = process.stdout.write.bind(process.stdout)
      process.stdout.write = () => true
      try {
        await build(site, 'publish')
      } finally {
        process.stdout.write = write
      }
      const html = await readFile(join(site, '.hadley', 'publish', 'notes', 'source', 'index.html'), 'utf-8')
      assert.ok(html.includes('<time datetime="2026-11-10'), 'the note shows its date')
      assert.ok(
        html.includes('<a href="https://github.com/mkorun/hadley">github.com/mkorun/hadley</a>'),
        'and its link',
      )
    })
})
