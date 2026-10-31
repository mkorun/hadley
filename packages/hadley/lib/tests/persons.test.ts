import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import loadSite from '../load-site.ts'

// A person (lib/persons.ts) as each language reads it: a page's author and the site's owner.

let dir: string

/**
 * A site `name` in en and de whose person is `person`, with an about page and an article by the person; `config` is
 * added to its config.lima.
 */
async function site(name: string, person: string, config = '') {
  const root = join(dir, name)
  const files: Record<string, string> = {
    'config.lima': `site:\n  origin: https://test.example\n  owner: $(persons/ada)\n  default:\n    language: en\n    title: Test\n${config}`,
    'content/meta/persons/ada.lima': person,
    'content/pages/[about]/about.md': '---\ntitle: About\n---\nText.\n',
    'content/pages/[about]/de/ueber-mich.md': '---\ntitle: Über mich\n---\nText.\n',
    'content/articles/[a]/a.md': '---\ntitle: A\npublishFrom: 2026-01-01\nauthor: $(persons/ada)\n---\nText.\n',
    'content/articles/[a]/de/a.md': '---\ntitle: A\npublishFrom: 2026-01-01\nauthor: $(persons/ada)\n---\nText.\n',
  }
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-persons-test-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('a person', () => {
  it('reads the block of the page language over its fields, and its $id url as that page in the language', async () => {
    const root = await site(
      'blocks',
      'name: Ada\nemail: ada@test.example\nurl: $about\nbio: Writes.\nde:\n  bio: Schreibt.\n',
    )
    const loaded = await loadSite(root, true)
    const en = loaded.content.en!
    const de = loaded.content.de!
    assert.deepEqual(en.pages.a!.metadata.author, {
      name: 'Ada',
      email: 'ada@test.example',
      url: '/about/',
      bio: 'Writes.',
    })
    assert.deepEqual(de.pages.a!.metadata.author, {
      name: 'Ada',
      email: 'ada@test.example',
      url: '/de/ueber-mich/',
      bio: 'Schreibt.',
    })
    assert.equal(de.ownerLinks!.bio, 'Schreibt.')
    assert.equal(de.ownerLinks!.emailMailto, 'mailto:ada@test.example')
  })

  it('stops the build for a url to a page the language does not list, and for a language that is no block', async () => {
    await assert.rejects(
      loadSite(await site('no-page', 'name: Ada\nurl: $nowhere\n'), true),
      /url \$nowhere: the language "en" lists no page nowhere/,
    )
    await assert.rejects(loadSite(await site('no-block', 'name: Ada\nde: Ada\n'), true), /de is a language of the site/)
  })
})

describe('the profiles of the owner', () => {
  const ada =
    'name: Ada\ngithub: https://github.com/ada\nmastodon: https://social.example/@ada\nde:\n  github: https://github.com/ada-de\n'

  it('are those config.lima names, in its order, with their label and the URL of the language', async () => {
    const loaded = await loadSite(await site('profiles', ada, 'profiles: [mastodon, github]\n'), true)
    assert.deepEqual(loaded.content.en!.ownerLinks!.profiles, [
      { network: 'mastodon', label: 'Mastodon', url: 'https://social.example/@ada' },
      { network: 'github', label: 'GitHub', url: 'https://github.com/ada' },
    ])
    assert.deepEqual(loaded.content.de!.ownerLinks!.profiles, [
      { network: 'mastodon', label: 'Mastodon', url: 'https://social.example/@ada' },
      { network: 'github', label: 'GitHub', url: 'https://github.com/ada-de' },
    ])
  })

  it('are none without profiles, whatever the owner has', async () => {
    const loaded = await loadSite(await site('no-profiles', ada), true)
    assert.deepEqual(loaded.content.en!.ownerLinks!.profiles, [])
  })

  it('stop the build for a name that is no profile, one the owner has not, and profiles without an owner', async () => {
    await assert.rejects(
      loadSite(await site('unknown', ada, 'profiles: [github, myspace]\n'), true),
      /profiles: myspace is not one of github, mastodon/,
    )
    await assert.rejects(
      loadSite(await site('missing', ada, 'profiles: [bluesky]\n'), true),
      /profiles: bluesky: the owner \(site.owner\) has no bluesky/,
    )
    await assert.rejects(loadSite(await site('one', ada, 'profiles: github\n'), true), /profiles is a list of profiles/)
    const root = await site('no-owner', ada, 'profiles: [github]\n')
    const config = join(root, 'config.lima')
    await writeFile(config, (await readFile(config, 'utf-8')).replace('  owner: $(persons/ada)\n', ''))
    await assert.rejects(loadSite(root, true), /site.owner names none/)
  })
})
