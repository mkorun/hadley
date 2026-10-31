// merge.test.ts — tests for mergeComment (the tree merge)

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mergeComment, type PublicComment } from '../merge.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hadley-merge-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function path(name = 'comments.json'): string {
  return join(dir, name)
}

async function read(file = 'comments.json'): Promise<PublicComment[]> {
  return JSON.parse(await readFile(join(dir, file), 'utf-8'))
}

function entry(
  overrides: Partial<{
    id: string
    parent_comment_id: string | null
    name: string
    submitted_at: string
    text: string
    author_reply: boolean
  }> = {},
) {
  return {
    id: crypto.randomUUID(),
    parent_comment_id: null,
    name: 'Tester',
    submitted_at: new Date().toISOString(),
    text: 'Test comment',
    author_reply: false,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergeComment — file handling', () => {
  it('creates a new file if it does not exist', async () => {
    const p = path()
    const e = entry()
    await mergeComment(p, e)
    const tree = await read()
    assert.equal(tree.length, 1)
    assert.equal(tree[0].id, e.id)
  })

  it('appends to an existing file', async () => {
    const p = path()
    const first = entry({ submitted_at: '2026-01-01T10:00:00.000Z' })
    await mergeComment(p, first)
    const second = entry({ submitted_at: '2026-01-02T10:00:00.000Z' })
    await mergeComment(p, second)
    const tree = await read()
    assert.equal(tree.length, 2)
  })

  it('defaults author_reply to false when not provided', async () => {
    const p = path()
    const e = entry()
    const { author_reply: _, ...withoutField } = e
    await mergeComment(p, withoutField as Parameters<typeof mergeComment>[1])
    const tree = await read()
    assert.equal(tree[0].author_reply, false)
  })

  it('preserves author_reply: true', async () => {
    const p = path()
    const e = entry({ author_reply: true })
    await mergeComment(p, e)
    const tree = await read()
    assert.equal(tree[0].author_reply, true)
  })

  it('initializes nested comments array as []', async () => {
    const p = path()
    await mergeComment(p, entry())
    const tree = await read()
    assert.deepEqual(tree[0].comments, [])
  })
})

describe('mergeComment — top-level chronological ordering', () => {
  it('inserts single comment at top level', async () => {
    const p = path()
    const e = entry({ text: 'solo' })
    await mergeComment(p, e)
    const tree = await read()
    assert.equal(tree[0].text, 'solo')
  })

  it('appends comment with later timestamp at the end', async () => {
    const p = path()
    const a = entry({ submitted_at: '2026-01-01T10:00:00.000Z', text: 'A' })
    const b = entry({ submitted_at: '2026-01-02T10:00:00.000Z', text: 'B' })
    await mergeComment(p, a)
    await mergeComment(p, b)
    const tree = await read()
    assert.deepEqual(
      tree.map((c) => c.text),
      ['A', 'B'],
    )
  })

  it('inserts comment with earlier timestamp before later ones', async () => {
    const p = path()
    const later = entry({ submitted_at: '2026-01-03T10:00:00.000Z', text: 'C' })
    const middle = entry({ submitted_at: '2026-01-02T10:00:00.000Z', text: 'B' })
    const early = entry({ submitted_at: '2026-01-01T10:00:00.000Z', text: 'A' })
    await mergeComment(p, later)
    await mergeComment(p, middle)
    await mergeComment(p, early)
    const tree = await read()
    assert.deepEqual(
      tree.map((c) => c.text),
      ['A', 'B', 'C'],
    )
  })

  it('inserts between two existing comments at the correct position', async () => {
    const p = path()
    await mergeComment(p, entry({ submitted_at: '2026-01-01T10:00:00Z', text: 'A' }))
    await mergeComment(p, entry({ submitted_at: '2026-01-03T10:00:00Z', text: 'C' }))
    await mergeComment(p, entry({ submitted_at: '2026-01-02T10:00:00Z', text: 'B' }))
    const tree = await read()
    assert.deepEqual(
      tree.map((c) => c.text),
      ['A', 'B', 'C'],
    )
  })
})

describe('mergeComment — nested inserts', () => {
  it('inserts reply as child of matching parent', async () => {
    const p = path()
    const parent = entry({ text: 'Parent' })
    await mergeComment(p, parent)

    const reply = entry({ parent_comment_id: parent.id, text: 'Reply' })
    await mergeComment(p, reply)

    const tree = await read()
    assert.equal(tree.length, 1)
    assert.equal(tree[0].comments.length, 1)
    assert.equal(tree[0].comments[0].text, 'Reply')
    assert.equal(tree[0].comments[0].id, reply.id)
  })

  it('sorts replies chronologically within parent', async () => {
    const p = path()
    const parent = entry({ text: 'Parent' })
    await mergeComment(p, parent)

    const r2 = entry({ parent_comment_id: parent.id, submitted_at: '2026-01-02T10:00:00Z', text: 'R2' })
    const r1 = entry({ parent_comment_id: parent.id, submitted_at: '2026-01-01T10:00:00Z', text: 'R1' })
    await mergeComment(p, r2)
    await mergeComment(p, r1)

    const tree = await read()
    assert.deepEqual(
      tree[0].comments.map((c) => c.text),
      ['R1', 'R2'],
    )
  })

  it('inserts deeply nested reply (grandchild)', async () => {
    const p = path()
    const grandparent = entry({ text: 'GP' })
    await mergeComment(p, grandparent)

    const parent = entry({ parent_comment_id: grandparent.id, text: 'P' })
    await mergeComment(p, parent)

    const child = entry({ parent_comment_id: parent.id, text: 'C' })
    await mergeComment(p, child)

    const tree = await read()
    assert.equal(tree[0].comments[0].comments[0].text, 'C')
  })
})

describe('mergeComment — orphan fallback', () => {
  it('appends as top-level when parent_comment_id is not found in tree', async () => {
    const p = path()
    const existing = entry({ text: 'Existing' })
    await mergeComment(p, existing)

    const orphan = entry({ parent_comment_id: 'nonexistent-id', text: 'Orphan' })
    await mergeComment(p, orphan)

    const tree = await read()
    // Orphan lands at top level
    assert.equal(tree.length, 2)
    // parent_comment_id is cleared on fallback
    const orphanNode = tree.find((c) => c.text === 'Orphan')!
    assert.equal(orphanNode.parent_comment_id, null)
  })

  it('handles orphan insert into empty tree', async () => {
    const p = path()
    const orphan = entry({ parent_comment_id: 'nonexistent-id', text: 'Solo orphan' })
    await mergeComment(p, orphan)

    const tree = await read()
    assert.equal(tree.length, 1)
    assert.equal(tree[0].parent_comment_id, null)
  })
})
