import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from '../../index.ts'
import loadSite from '../load-site.ts'
import { fallingBehind, relink, siteHref, sourceFiles, sourcesOf, type Source } from '../sources.ts'

// Pages of another git repository (lib/sources.ts, docs/sources.md), read from a repository made here.

let dir: string

const run = (cwd: string, ...args: string[]) => {
  const done = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@test.example', ...args], {
    cwd,
    timeout: 30_000,
  })
  assert.equal(done.status, 0, done.stderr?.toString())
}

/** What git writes to stdout for `args`, given `input`. */
const output = (cwd: string, input: string, ...args: string[]) => {
  const done = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@test.example', ...args], {
    cwd,
    input,
    timeout: 30_000,
  })
  assert.equal(done.status, 0, done.stderr?.toString())
  return done.stdout.toString().trim()
}

async function files(root: string, all: Record<string, string>) {
  for (const [file, text] of Object.entries(all)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), text)
  }
}

/** A repository with docs/a.md, docs/b.md and a picture, its first commit tagged v1. */
async function repository(name: string, a: string) {
  const root = join(dir, name)
  await files(root, {
    'AGENTS.md': '# Agents\n',
    'docs/a.md': a,
    'docs/b.md': '# B\n\n## The part\n\nText.\n',
    'docs/flow.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>',
  })
  run(root, 'init', '--quiet')
  run(root, 'add', '.')
  run(root, 'commit', '--quiet', '-m', 'docs')
  run(root, 'tag', 'v1')
  return root
}

/** A site whose source `docs` is `repo` at `ref`, with `entries` as its pages. */
async function site(
  name: string,
  repo: string,
  ref = 'v1',
  entries = '      a:\n        linktext: A page\n      b:\n',
  more = '',
) {
  const root = join(dir, name)
  await files(root, {
    'config.lima':
      'site:\n  origin: https://test.example\n  default:\n    language: en\n    title: Test\n' +
      `sources:\n  docs:\n    repository: https://github.com/example/tool\n    ref: ${ref}\n` +
      `    checkout: ../${repo}\n    path: docs\n    root: pages\n    urlPath: /docs/\n    pages:\n${entries}${more}`,
    'content/pages/[home]/home.md': '---\ntitle: Home\nurlPath: /\n---\nSee [the docs]($docs-a).\n',
    'theme/templates/page.chase':
      '<galley:config>{"images":{"default":{"widths":[480],"formats":["webp"],"sizes":"100vw","quality":80}}}</galley:config>' +
      '<!doctype html><title>{ meta.title }</title>{ meta.linktext }{@raw html.markup}',
  })
  return root
}

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = () => true
  try {
    return await work()
  } finally {
    process.stdout.write = write
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-sources-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the sources of config.lima', () => {
  const config = (docs: Record<string, unknown>) => ({
    sources: {
      docs: {
        repository: 'https://github.com/x/r',
        ref: 'v1',
        path: 'docs',
        root: 'pages',
        urlPath: '/docs/',
        ...docs,
      },
    },
  })

  it('give each page its URL path below the source, unless its entry names one', () => {
    const [source] = sourcesOf(config({ pages: { a: null, b: { urlPath: '/b/', linktext: 'B' } } }), '/site')
    assert.deepEqual(source!.pages, { 'docs-a': { urlPath: '/docs/a/' }, 'docs-b': { urlPath: '/b/', linktext: 'B' } })
    assert.equal(source!.checkout, undefined)
    assert.equal(
      sourcesOf(config({ checkout: '../repo', pages: { a: null } }), '/site/x')[0]!.checkout,
      resolve('/site/repo'),
    )
  })

  it('take a dot in the name of a page between two of its parts', () => {
    const [source] = sourcesOf(config({ pages: { 'lima-core-1.0-spec': null } }), '/site')
    assert.deepEqual(source!.pages, { 'docs-lima-core-1.0-spec': { urlPath: '/docs/lima-core-1.0-spec/' } })
    assert.throws(() => sourcesOf({ sources: { 'a.b': {} } }, '/site'), /named with lower-case letters/)
  })

  it('read the pages from the root of the repository without a path', () => {
    const [source] = sourcesOf(config({ path: undefined, pages: { spec: null } }), '/site')
    assert.equal(source!.path, '')
    assert.throws(
      () => sourcesOf(config({ path: '', pages: { a: null } }), '/site'),
      /path is a folder of the repository/,
    )
    assert.throws(
      () => sourcesOf(config({ path: undefined, pages: {} }), '/site'),
      /pages names the files of its repository/,
    )
  })

  it('stop the build when a value is missing or not what it must be', () => {
    for (const [docs, message] of [
      [{ repository: 'git@github.com:x/r.git', pages: { a: null } }, /repository is a repository on GitHub/],
      // review 2026-10-29: a password in the URL would show in messages
      [{ repository: 'https://me:secret@github.com/x/r', pages: { a: null } }, /repository is a repository on GitHub/],
      [{ repository: 'https://gitlab.com/x/r', pages: { a: null } }, /repository is a repository on GitHub/],
      [{ ref: '', pages: { a: null } }, /ref is the commit or tag/],
      // review 2026-10-29: git read a ref beginning with - as one of its options
      [{ ref: '--upload-pack=touch /tmp/x', pages: { a: null } }, /ref is the commit or tag/],
      [{ ref: 'v1..v2', pages: { a: null } }, /ref is the commit or tag/],
      [{ path: '../docs', pages: { a: null } }, /path is a folder of the repository/],
      [{ frozen: 'yes', pages: { a: null } }, /frozen is true or false/],
      [{ root: 'docs', pages: { a: null } }, /root is one of articles, essays, notes, pages/],
      [{ urlPath: '/docs', pages: { a: null } }, /urlPath is the URL path the pages stand under/],
      [{ pages: {} }, /pages names the files of docs/],
      [{ pages: { '../x': null } }, /\.\.\/x is not the name of a file of docs/],
      [{ pages: { '.hidden': null } }, /\.hidden is not the name of a file of docs/],
      [{ pages: { 'a..b': null } }, /a\.\.b is not the name of a file of docs/],
      [{ pages: { 'spec.': null } }, /spec\. is not the name of a file of docs/],
    ] as const)
      assert.throws(() => sourcesOf(config(docs), '/site'), message)
    assert.throws(() => sourcesOf({ sources: { Docs: {} } }, '/site'), /named with lower-case letters/)
  })

  it('give data, pages or both; root and urlPath belong to pages', () => {
    const data = (docs: Record<string, unknown>) => ({
      sources: { docs: { repository: 'https://github.com/x/r', ref: 'v1', path: 'docs', ...docs } },
    })
    const [only] = sourcesOf(data({ data: { tool: 'facts.lima', more: 'more.facts.lima' } }), '/site')
    assert.deepEqual(only!.data, { tool: 'docs/facts.lima', more: 'docs/more.facts.lima' })
    assert.deepEqual(only!.pages, {})
    assert.equal(only!.root, undefined)
    for (const [docs, message] of [
      [{}, /gives pages, data or both/],
      [{ root: 'pages', data: { tool: 'facts.lima' } }, /root and urlPath belong to its pages/],
      [{ data: {} }, /data names Lima files of docs/],
      [{ data: { Tool: 'facts.lima' } }, /Tool is named with lower-case letters and digits/],
      [{ data: { tool: 'facts.json' } }, /data\.tool is the name of a Lima file of docs/],
      [{ data: { tool: '../facts.lima' } }, /data\.tool is the name of a Lima file of docs/],
      [{ data: { tool: 'sub/facts.lima' } }, /data\.tool is the name of a Lima file of docs/],
    ] as const)
      assert.throws(() => sourcesOf(data(docs), '/site'), message)
    assert.throws(
      () =>
        sourcesOf(
          {
            sources: {
              one: { repository: 'https://github.com/x/a', ref: 'v1', data: { tool: 'a.lima' } },
              two: { repository: 'https://github.com/x/b', ref: 'v1', data: { tool: 'b.lima' } },
            },
          },
          '/site',
        ),
      /sources\.one and sources\.two both give data tool/,
    )
  })
})

describe('a link of a page of a source', () => {
  const source: Source = {
    name: 'docs',
    repository: 'https://github.com/example/tool',
    ref: 'v1',
    checkout: undefined,
    frozen: false,
    path: 'docs',
    root: 'pages',
    pages: { 'docs-a': {}, 'docs-b': {} },
    data: {},
  }
  const href = (target: string, pictures: string[] = []) => {
    const link = siteHref(source, 'docs/a.md', target, (path) => pictures.push(path))
    return 'href' in link ? link.href : `problem: ${link.problem}`
  }

  it('leads to another page of the source by its id, and to any other file of the repository on GitHub', () => {
    assert.equal(href('b.md#the-part'), '$docs-b#the-part')
    assert.equal(href('go.md'), 'https://github.com/example/tool/blob/v1/docs/go.md')
    assert.equal(href('../AGENTS.md#rules'), 'https://github.com/example/tool/blob/v1/AGENTS.md#rules')
  })

  it('brings a picture of the folder into the bundle; one outside it, or a link out of the repository, is a problem', () => {
    const pictures: string[] = []
    assert.equal(href('img/flow.svg', pictures), 'flow.svg')
    assert.deepEqual(pictures, ['docs/img/flow.svg'])
    assert.equal(
      href('../logo.png'),
      'problem: the picture ../logo.png is not in docs/ of https://github.com/example/tool',
    )
    assert.equal(
      href('../../outside.md'),
      'problem: the link ../../outside.md leaves the repository https://github.com/example/tool',
    )
  })

  it('of a source at the root of its repository takes every file of it as its own', () => {
    const root: Source = { ...source, path: '', pages: { 'docs-spec': {} } }
    const pictures: string[] = []
    const link = (target: string) => {
      const result = siteHref(root, 'spec.md', target, (path) => pictures.push(path))
      return 'href' in result ? result.href : `problem: ${result.problem}`
    }
    assert.equal(link('spec.md#tables'), '$docs-spec#tables')
    assert.equal(link('data/x.json'), 'https://github.com/example/tool/blob/v1/data/x.json')
    assert.equal(link('img/flow.svg'), 'flow.svg')
    assert.deepEqual(pictures, ['img/flow.svg'])
    assert.equal(link('../x.md'), 'problem: the link ../x.md leaves the repository https://github.com/example/tool')
  })

  // review 2026-10-29: the query stayed in the path, so b.md?plain=1 was taken for another file
  it('keeps a query and an anchor', () => {
    assert.equal(href('b.md?plain=1#x'), '$docs-b?plain=1#x')
    assert.equal(href('flow.svg?raw=1'), 'flow.svg?raw=1')
    assert.equal(href('../AGENTS.md?plain=1'), 'https://github.com/example/tool/blob/v1/AGENTS.md?plain=1')
  })

  it('is changed outside code only, and as CommonMark reads its destination', () => {
    const mark = (text: string) => relink(text, (target) => `<${target}>`)
    assert.equal(mark('[b](b.md) `[b](b.md)` `` ` [b](b.md) ``'), '[b](<b.md>) `[b](b.md)` `` ` [b](b.md) ``')
    assert.equal(mark('```\n[b](b.md)\n```\n[x](a_(b).md "T")'), '```\n[b](b.md)\n```\n[x](<a_(b).md> "T")')
  })
})

describe('a site with a source', () => {
  it('builds its pages from the repository at the ref, with their fields, links and pictures', async () => {
    const repo = await repository(
      'repo-build',
      '# A\n\nSee [the part](b.md#the-part), [the rules](../AGENTS.md) and ![the flow](flow.svg).\n',
    )
    const root = await site('site-build', 'repo-build')
    await quiet(() => build(root, 'publish'))
    const a = await readFile(join(root, '.hadley', 'publish', 'docs', 'a', 'index.html'), 'utf8')
    assert.match(a, /<title>A<\/title>A page/)
    assert.match(a, /href="\/docs\/b\/#the-part"/)
    assert.match(a, /href="https:\/\/github\.com\/example\/tool\/blob\/v1\/AGENTS\.md"/)
    // the picture came with the page: the build made it into its sizes
    assert.match(a, /<img [^>]*src="[^"]*flow[^"]*"/)
    assert.ok(existsSync(join(root, '.hadley', 'publish', 'docs', 'b', 'index.html')))
    assert.ok(!existsSync(join(root, 'content', 'pages', '[docs-a]')), 'nothing is copied into content/')

    // the same ref is read from the cache, without the repository
    await rename(repo, `${repo}.away`)
    await quiet(() => build(root, 'publish'))
    await rename(`${repo}.away`, repo)
  })

  it('reads the commit the ref names, not what is checked out', async () => {
    const repo = await repository('repo-ref', '# A\n\nThe first.\n')
    await writeFile(join(repo, 'docs', 'a.md'), '# A\n\nThe second.\n')
    run(repo, 'commit', '--quiet', '-am', 'second')
    const root = await site('site-ref', 'repo-ref')
    await quiet(() => build(root, 'publish'))
    assert.match(await readFile(join(root, '.hadley', 'publish', 'docs', 'a', 'index.html'), 'utf8'), /The first\./)
  })

  it('counts the commits of the checkout that change its pages after the ref', async () => {
    const repo = await repository('repo-behind', '# A\n\nThe first.\n')
    const source = (): Source =>
      sourcesOf(
        {
          sources: {
            docs: {
              repository: 'https://github.com/x/r',
              ref: 'v1',
              checkout: repo,
              path: 'docs',
              root: 'pages',
              urlPath: '/docs/',
              pages: { a: null },
            },
          },
        },
        dir,
      )[0]!
    assert.equal(fallingBehind(source()), undefined)
    await writeFile(join(repo, 'AGENTS.md'), '# Agents, again\n')
    await writeFile(join(repo, 'docs', 'b.md'), '# B, not a page of it\n')
    run(repo, 'commit', '--quiet', '-am', 'no page of the source')
    assert.equal(fallingBehind(source()), undefined)
    for (const text of ['second', 'third']) {
      await writeFile(join(repo, 'docs', 'a.md'), `# A\n\nThe ${text}.\n`)
      run(repo, 'commit', '--quiet', '-am', text)
    }
    assert.equal(fallingBehind(source()), `sources.docs: 2 newer commits in ${repo} change its files after v1`)
    assert.equal(fallingBehind({ ...source(), checkout: undefined }), undefined)
    assert.equal(fallingBehind({ ...source(), checkout: join(dir, 'no-such-clone') }), undefined)
    assert.equal(fallingBehind({ ...source(), frozen: true }), undefined)
  })

  it('gives its data to the templates, read at the ref, and counts the commits that change it', async () => {
    const repo = await repository('repo-data', '# A\n')
    await writeFile(
      join(repo, 'docs', 'facts.lima'),
      'version: 1.2.0\ncases:\n  core: 620\nreleased: 2026-11-10\nnote: "<b>bold</b> & more"\n',
    )
    run(repo, 'add', '.')
    run(repo, 'commit', '--quiet', '-m', 'facts')
    run(repo, 'tag', 'v2')
    await writeFile(join(repo, 'docs', 'facts.lima'), 'version: 9.9.9\ncases:\n  core: 1\n')
    run(repo, 'commit', '--quiet', '-am', 'later facts')
    const root = join(dir, 'site-data')
    const config =
      'site:\n  origin: https://test.example\n  default:\n    language: en\n    title: Test\n  de:\n    title: Test\n' +
      'sources:\n  tool:\n    repository: https://github.com/example/tool\n    ref: v2\n' +
      '    checkout: ../repo-data\n    path: docs\n    data:\n      tool: facts.lima\n'
    await files(root, {
      'config.lima': config,
      'content/pages/[home]/home.md': '---\ntitle: Home\nurlPath: /\n---\nHello.\n',
      'content/pages/[home]/de/home.md': '---\ntitle: Start\nurlPath: /de/\n---\nHallo.\n',
      'theme/templates/page.chase':
        '<!doctype html><title>{ meta.title }</title><p>{ site.data.tool.version } { site.data.tool.cases.core }</p>' +
        '<p>{ site.data.tool.released | isoDate }</p><p>{ site.data.tool.note }</p>',
    })
    await quiet(() => build(root, 'publish'))
    for (const page of ['index.html', 'de/index.html']) {
      const html = await readFile(join(root, '.hadley', 'publish', page), 'utf8')
      assert.match(html, /<p>1\.2\.0 620<\/p>/, page)
      assert.match(html, /<p>2026-11-10/, page)
      // a value of the data is text, written escaped, never markup
      assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; more/, page)
    }
    // another file under the name: read again, not from the cache of the first
    await writeFile(join(repo, 'docs', 'other.lima'), 'version: 3.0.0\n')
    run(repo, 'add', '.')
    run(repo, 'commit', '--quiet', '-m', 'other')
    run(repo, 'tag', 'v3')
    await writeFile(
      join(root, 'config.lima'),
      config.replace('ref: v2', 'ref: v3').replace('tool: facts.lima', 'tool: other.lima'),
    )
    await quiet(() => build(root, 'publish'))
    assert.match(await readFile(join(root, '.hadley', 'publish', 'index.html'), 'utf8'), /<p>3\.0\.0\s*<\/p>/)
    await writeFile(join(root, 'config.lima'), config)
    const [source] = sourcesOf((await loadSite(root)).config, root)
    assert.equal(fallingBehind(source!), `sources.tool: 1 newer commit in ${repo} changes its files after v2`)
  })

  it('gives a template no way to write its data as markup', async () => {
    const root = join(dir, 'site-data-raw')
    await files(root, {
      'config.lima':
        'site:\n  origin: https://test.example\n  default:\n    language: en\n    title: Test\n' +
        'sources:\n  tool:\n    repository: https://github.com/example/tool\n    ref: v2\n' +
        '    checkout: ../repo-data\n    path: docs\n    data:\n      tool: facts.lima\n',
      'content/pages/[home]/home.md': '---\ntitle: Home\nurlPath: /\n---\nHello.\n',
      'theme/templates/page.chase': '<!doctype html><title>{ meta.title }</title>{@raw site.data.tool.note}',
    })
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /raw/i,
    )
  })

  it('stops at a data file that is no Lima', async () => {
    const repo = await repository('repo-data-bad', '# A\n')
    await writeFile(join(repo, 'docs', 'facts.lima'), 'version 1.2.0\n')
    run(repo, 'add', '.')
    run(repo, 'commit', '--quiet', '-m', 'facts')
    run(repo, 'tag', 'v2')
    const root = join(dir, 'site-data-bad')
    await files(root, {
      'config.lima':
        'site:\n  origin: https://test.example\n  default:\n    language: en\n    title: Test\n' +
        'sources:\n  tool:\n    repository: https://github.com/example/tool\n    ref: v2\n' +
        '    checkout: ../repo-data-bad\n    path: docs\n    data:\n      tool: facts.lima\n',
      'content/pages/[home]/home.md': '---\ntitle: Home\nurlPath: /\n---\nHello.\n',
      'theme/templates/page.chase': '<!doctype html><title>{ meta.title }</title>',
    })
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /sources\.tool\.data\.tool: docs\/facts\.lima at v2 is no Lima/,
    )
  })

  it('stops at a ref the repository does not have', async () => {
    await repository('repo-missing', '# A\n')
    const root = await site('site-missing', 'repo-missing', 'v9')
    await assert.rejects(
      quiet(() => build(root, 'publish')),
      /has no commit v9/,
    )
  })

  it('fails a published page whose link leaves the repository, also when its files come from the cache', async () => {
    await repository('repo-out', '# A\n\nSee [outside](../../outside.md).\n')
    const root = await site('site-out', 'repo-out')
    for (const _ of [1, 2])
      await assert.rejects(
        quiet(() => build(root, 'publish')),
        /the link \.\.\/\.\.\/outside\.md leaves the repository/,
      )
  })

  // a picture is written into the bundle under the last segment of its path, where Windows reads a backslash as a
  // separator: `..\\..\\escape.png` wrote a file of the repository outside the cache, and outside the site
  it('fails a published page whose link holds a backslash, and writes no file of it outside the cache', async () => {
    const repo = join(dir, 'repo-backslash')
    await mkdir(repo)
    run(repo, 'init', '--quiet')
    // from the bundle's folder in the cache up to dir; a tree can name such a file, a Windows checkout cannot
    const escape = `${'..\\'.repeat(8)}escape.png`
    const blob = (text: string) => output(repo, text, 'hash-object', '-w', '--stdin')
    const page = blob(`# A\n\n![x](<${escape}>)\n`)
    const docs = output(repo, `100644 blob ${page}\ta.md\n100644 blob ${blob('png')}\t${escape}\n`, 'mktree')
    const commit = output(repo, '', 'commit-tree', output(repo, `040000 tree ${docs}\tdocs\n`, 'mktree'), '-m', 'a')
    run(repo, 'update-ref', 'HEAD', commit)
    run(repo, 'tag', 'v1')
    const root = await site('site-backslash', 'repo-backslash', 'v1', '      a:\n')
    const failed = await quiet(() => build(root, 'publish')).then(
      () => 'published',
      (error: unknown) => String(error),
    )
    assert.ok(!existsSync(join(dir, 'escape.png')), 'a file of the repository outside the site')
    assert.match(failed, /the link \S*escape\.png holds a backslash/)
  })

  it('reads its files again for another checkout', async () => {
    await repository('repo-one', '# A\n\nFrom one.\n')
    await repository('repo-two', '# A\n\nFrom two.\n')
    const root = await site('site-checkout', 'repo-one')
    await quiet(() => build(root, 'publish'))
    const config = join(root, 'config.lima')
    await writeFile(config, (await readFile(config, 'utf8')).replace('../repo-one', '../repo-two'))
    await quiet(() => build(root, 'publish'))
    assert.match(await readFile(join(root, '.hadley', 'publish', 'docs', 'a', 'index.html'), 'utf8'), /From two\./)
  })

  // review 2026-10-29: the fields were added after the aliases were read, so a field under its alias was given twice
  it('reads a field of the file under its alias, and of the entry too', async () => {
    await repository('repo-alias', '---\nbeschreibung: Its own\n---\n# A\n')
    const entries = '      a:\n        description: From config\n      b:\n        beschreibung: Also from config\n'
    const root = await site(
      'site-alias',
      'repo-alias',
      'v1',
      entries,
      'metadata:\n  description:\n    aliases: [beschreibung]\n',
    )
    const loaded = await quiet(() => loadSite(root, false))
    const pages = loaded.content.en!.pages
    assert.equal(pages['docs-a']!.metadata.description, 'Its own')
    assert.equal(pages['docs-b']!.metadata.description, 'Also from config')
    assert.deepEqual(
      loaded.problems.filter((problem) => problem.page === pages['docs-a']).map((problem) => problem.message),
      ['the front matter field description is given by sources in config.lima as well'],
    )
  })

  it('takes a field from config.lima or from the file, and a field given by both is a problem of the page', async () => {
    await repository('repo-twice', '---\nlinktext: Its own\n---\n# A\n')
    const root = await site('site-twice', 'repo-twice')
    const loaded = await quiet(() => loadSite(root, false))
    const page = loaded.content.en!.pages['docs-a']!
    assert.equal(page.fromSource, 'docs')
    assert.equal(page.metadata.linktext, 'Its own')
    assert.deepEqual(
      loaded.problems.filter((problem) => problem.page === page).map((problem) => problem.message),
      ['the front matter field linktext is given by sources in config.lima as well'],
    )
    // the cache holds the files only: the fields are not in them
    const { dir: cached } = sourceFiles(sourcesOf(loaded.config, root)[0]!, root)
    assert.doesNotMatch(await readFile(join(cached, 'pages', '[docs-a]', 'docs-a.md'), 'utf8'), /A page/)
  })
})
