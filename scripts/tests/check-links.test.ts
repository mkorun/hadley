import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { githubSlug, hadleySlug, headings, ids, linkProblems, links } from '../check-links.ts'

// The documentation's links (scripts/check-links.ts): they lead where they lead on GitHub, also on hadley.sh.

const files: Record<string, string> = {
  'docs/a.md': [
    '# A',
    '',
    'See [b](b.md), [its part](b.md#the-part), [here](#a) and [the readme](../README.md).',
    'A [missing](gone.md), an [anchor GitHub alone knows](b.md#configlima) and ![a picture](pic.png).',
    '',
    '```md',
    '[not a link](nowhere.md)',
    '```',
    '',
    'And `[no link](nowhere.md)` either, nor [a site](https://example.org/x.md).',
  ].join('\n'),
  'docs/b.md': '# B\n\n## The part\n\n## config.lima\n',
  'README.md': '# hadley\n',
}
const tracked = new Set(Object.keys(files))
const read = (path: string) => files[path] ?? ''

describe('the links of the documentation', () => {
  it('are the relative targets outside code', () => {
    assert.deepEqual(
      links(files['docs/a.md']!).map(({ target, line }) => `${line}:${target}`),
      ['3:b.md', '3:b.md#the-part', '3:#a', '3:../README.md', '4:gone.md', '4:b.md#configlima', '4:pic.png'],
    )
  })

  it('lead to a file git tracks, and to a heading both GitHub and hadley name so', () => {
    assert.deepEqual(linkProblems('docs/a.md', tracked, read), [
      'docs/a.md:4: gone.md names docs/gone.md, which git does not track',
      'docs/a.md:4: b.md#configlima: #configlima is not the id of a heading of docs/b.md on both GitHub and hadley.sh',
      'docs/a.md:4: pic.png names docs/pic.png, which git does not track',
    ])
  })
})

describe('the id of a heading', () => {
  it('is the same on GitHub and in hadley for words, and differs at punctuation', () => {
    assert.equal(githubSlug('The part'), 'the-part')
    assert.equal(hadleySlug('The part'), 'the-part')
    assert.equal(githubSlug('config.lima'), 'configlima')
    assert.equal(hadleySlug('config.lima'), 'config-lima')
  })

  it('counts a heading again from 1 on GitHub, from 2 in hadley', () => {
    assert.deepEqual([...ids(['A', 'A', 'A'], githubSlug, 1)], ['a', 'a-1', 'a-2'])
    assert.deepEqual([...ids(['A', 'A', 'A'], hadleySlug, 2)], ['a', 'a-2', 'a-3'])
  })

  it('is read from the heading’s words, without code marks, links or emphasis', () => {
    assert.deepEqual(headings('# `hadley dev`\n\n## A [link](x.md) and *more*\n\n```\n# no heading\n```\n'), [
      'hadley dev',
      'A link and more',
    ])
  })
})
