import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  blockIdMap,
  handleGet,
  handlePatch,
  handleDelete,
  handleMove,
  handleMerge,
  oneAtATime,
  readBody,
} from '../plugin.ts'
import { registerPageBlocks } from '../renderer.ts'
import { parseDocument, type BlockToken } from '../../../case/index.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

function mockReq(method: string, url: string, body = '', headers: Record<string, string> = {}): IncomingMessage {
  const r = new Readable({ read() {} }) as unknown as IncomingMessage
  ;(r as any).method = method
  ;(r as any).url = url
  ;(r as any).headers = { ...headers }
  process.nextTick(() => {
    ;(r as any).emit('data', Buffer.from(body, 'utf-8'))
    ;(r as any).emit('end')
  })
  return r
}

function mockRes(): ServerResponse & { body: string; headersSent: boolean } {
  const res: any = {
    statusCode: 200,
    body: '',
    headersSent: false,
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this._headers[k] = v
    },
    end(s: string) {
      this.body = s
      this.headersSent = true
    },
  }
  return res
}

// ─── Test file ─────────────────────────────────────────────────────────────────

let tmpDir: string
let tmpFile: string

beforeEach(async () => {
  blockIdMap.clear()
  tmpDir = await mkdtemp(join(tmpdir(), 'hadley-editor-test-'))
  tmpFile = join(tmpDir, 'test.md')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  blockIdMap.clear()
})

function registerMarkantoBlocks(content: string): string[] {
  const blocks = parseBlocks(content)
  const getBlockId = registerPageBlocks(blocks, content, tmpFile)
  return blocks.map((block) => getBlockId(block.start!)!)
}

function parseBlocks(content: string): BlockToken[] {
  return parseDocument(content, {}).blocks
}

describe('Markanto editor round trip', () => {
  const blockCases = [
    ['Absatz', 'Alt.', 'Neu.'],
    ['Heading', '## Alt', '## Neu'],
    ['Horizontalregel', '---', '***'],
    ['Codeblock', '```js\nconst alt = 1\n```', '```js\nconst neu = 2\n```'],
    ['Liste', '- Alt', '- Neu'],
    ['Zitat', '> Alt', '> Neu'],
    ['Tabelle', '| Alt |\n| --- |\n| Wert |', '| Neu |\n| --- |\n| Wert |'],
    ['Container', '::: loud\nAlt.\n:::', '::: loud\nNeu.\n:::'],
    ['Bild', '<f data-size=native>![Alt](alt.jpg)</f>', '<f data-size=native>![Neu](neu.jpg)</f>'],
    ['Video', '<v>[Alt](alt.mp4)</v>', '<v>[Neu](neu.mp4)</v>'],
    ['Audio', '<au>[Alt](alt.mp3)</au>', '<au>[Neu](neu.mp3)</au>'],
    ['Embed', '<e>[Alt](https://example.com/alt)</e>', '<e>[Neu](https://example.com/neu)</e>'],
    ['Fußnote', '[^x]: Alt.', '[^x]: Neu.'],
    ['Kommentar', '<!-- Alt. -->', '<!-- Neu. -->'],
  ] as const

  for (const [name, original, replacement] of blockCases) {
    it(`GET/PATCH keeps ${name} and its neighbours`, async () => {
      const content = `Davor.\n\n${original}\n\nDanach.\n`
      await writeFile(tmpFile, content, 'utf-8')
      const [, id] = registerMarkantoBlocks(content)

      const getRes = mockRes()
      await handleGet(mockReq('GET', `/__hadley/block/${id}`), getRes)
      assert.equal(getRes.statusCode, 200)
      assert.equal(JSON.parse(getRes.body).text, original)

      const patchRes = mockRes()
      await handlePatch(
        mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: replacement }), {
          'content-type': 'application/json',
        }),
        patchRes,
      )
      assert.equal(patchRes.statusCode, 200)
      const written = await readFile(tmpFile, 'utf8')
      assert.equal(written, `Davor.\n\n${replacement}\n\nDanach.\n`)
      assert.equal(parseDocument(written, {}).parseErrors, undefined)
    })
  }

  // review 2026-10-24 (follow-up): with CRLF line ends, an unchanged save wrote mixed line ends
  // review 2026-10-26 (dev server): `includes('application/json')` took text/plain with a parameter, which a page of
  // another site may send without asking the server first
  it('takes a write only as application/json, not a type that merely names it', async () => {
    const content = 'Davor.\n\nBody.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [, id] = registerMarkantoBlocks(content)
    for (const type of ['text/plain; x=application/json', 'text/plain;application/json', 'application/jsonx']) {
      const res = mockRes()
      await handlePatch(
        mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: 'Anders.' }), {
          'content-type': type,
        }),
        res,
      )
      assert.equal(res.statusCode, 415)
    }
    assert.equal(await readFile(tmpFile, 'utf8'), content)
  })

  // a file from a Windows editor has CRLF throughout: the editor edits it in LF and writes CRLF back
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')
  const post = async (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    url: string,
    body: unknown,
  ): Promise<number> => {
    const res = mockRes()
    await handler(mockReq('POST', url, JSON.stringify(body), { 'content-type': 'application/json' }), res)
    return res.statusCode
  }

  for (const [name, original, replacement] of blockCases) {
    it(`GET/PATCH keeps ${name} and its neighbours in a file with CRLF`, async () => {
      const content = crlf(`---\ntitle: T\n---\n\nDavor.\n\n${original}\n\nDanach.\n`)
      await writeFile(tmpFile, content, 'utf-8')
      const [, id] = registerMarkantoBlocks(content)

      const getRes = mockRes()
      await handleGet(mockReq('GET', `/__hadley/block/${id}`), getRes)
      assert.equal(getRes.statusCode, 200)
      assert.equal(JSON.parse(getRes.body).text, original)

      assert.equal(await post(handlePatch, '/__hadley/patch', { blockId: id, newText: replacement }), 200)
      assert.equal(await readFile(tmpFile, 'utf8'), crlf(`---\ntitle: T\n---\n\nDavor.\n\n${replacement}\n\nDanach.\n`))
    })
  }

  it('deletes, moves and merges blocks of a file with CRLF, and keeps its line ends', async () => {
    const start = crlf('Eins.\n\nZwei.\n\nDrei.\n')
    await writeFile(tmpFile, start, 'utf-8')
    let ids = registerMarkantoBlocks(start)
    assert.equal(await post(handleMove, '/__hadley/move', { blockId: ids[0], direction: 'down' }), 200)
    const moved = await readFile(tmpFile, 'utf8')
    assert.equal(moved, crlf('Zwei.\n\nEins.\n\nDrei.\n'))

    ids = registerMarkantoBlocks(moved)
    assert.equal(await post(handleMerge, '/__hadley/merge', { blockId: ids[1], direction: 'down' }), 200)
    const merged = await readFile(tmpFile, 'utf8')
    assert.equal(merged, crlf('Zwei.\n\nEins.\nDrei.\n'))

    ids = registerMarkantoBlocks(merged)
    assert.equal(await post(handleDelete, '/__hadley/delete', { blockId: ids[0] }), 200)
    assert.equal(await readFile(tmpFile, 'utf8'), crlf('Eins.\nDrei.\n'))
  })

  // review 2026-10-29: the last block of a file without a final line end lost the empty line before it on a move
  it('keeps two blocks apart when it moves the last block of a file without a final line end', async () => {
    for (const [content, expected] of [
      ['One.\n\nTwo.', 'Two.\n\nOne.\n'],
      [crlf('One.\n\nTwo.'), crlf('Two.\n\nOne.\n')],
    ]) {
      await writeFile(tmpFile, content!, 'utf-8')
      const [one] = registerMarkantoBlocks(content!)
      assert.equal(await post(handleMove, '/__hadley/move', { blockId: one, direction: 'down' }), 200)
      const written = await readFile(tmpFile, 'utf8')
      assert.equal(written, expected)
      assert.equal(parseBlocks(written).length, 2)
    }
  })

  // review 2026-10-29: "one\r" passed as "one\r\n" and was written back as \r\r\n
  it('refuses a text with a lone carriage return', async () => {
    for (const content of ['Davor.\n\nBody.\n', crlf('Davor.\n\nBody.\n')]) {
      await writeFile(tmpFile, content, 'utf-8')
      const [, id] = registerMarkantoBlocks(content)
      for (const newText of ['one\r', 'one\rtwo', '\rone'])
        assert.equal(await post(handlePatch, '/__hadley/patch', { blockId: id, newText }), 422)
      assert.equal(await readFile(tmpFile, 'utf8'), content)
    }
  })

  it('writes the line ends of the file, whichever a client sends', async () => {
    for (const [content, expected] of [
      ['Davor.\n\nBody.\n', 'Davor.\n\nZeile eins\nZeile zwei\n'],
      [crlf('Davor.\n\nBody.\n'), crlf('Davor.\n\nZeile eins\nZeile zwei\n')],
    ]) {
      await writeFile(tmpFile, content!, 'utf-8')
      const [, id] = registerMarkantoBlocks(content!)
      assert.equal(
        await post(handlePatch, '/__hadley/patch', { blockId: id, newText: 'Zeile eins\r\nZeile zwei' }),
        200,
      )
      assert.equal(await readFile(tmpFile, 'utf8'), expected)
    }
  })

  it('refuses a file that mixes line ends instead of saving it with others', async () => {
    for (const content of ['Davor.\r\n\r\nBody.\n', 'Davor.\n\nBody.\r\n', 'Davor.\r\rBody.\r']) {
      await writeFile(tmpFile, content, 'utf-8')
      const [id] = registerMarkantoBlocks(content)
      const getRes = mockRes()
      await handleGet(mockReq('GET', `/__hadley/block/${id}`), getRes)
      assert.equal(getRes.statusCode, 422)
      const patchRes = mockRes()
      await handlePatch(
        mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: 'Body.' }), {
          'content-type': 'application/json',
        }),
        patchRes,
      )
      assert.equal(patchRes.statusCode, 422)
      assert.ok(JSON.parse(patchRes.body).error.includes('CRLF'))
      assert.equal(await readFile(tmpFile, 'utf8'), content)
    }
  })

  it('GET/PATCH keeps the last block of a file without a final newline whole', async () => {
    const content = 'Davor.\n\nLetztes Zeichen.'
    await writeFile(tmpFile, content, 'utf-8')
    const [, id] = registerMarkantoBlocks(content)
    const getRes = mockRes()
    await handleGet(mockReq('GET', `/__hadley/block/${id}`), getRes)
    assert.equal(JSON.parse(getRes.body).text, 'Letztes Zeichen.')

    const patchRes = mockRes()
    await handlePatch(
      mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: 'Vollständig.' }), {
        'content-type': 'application/json',
      }),
      patchRes,
    )
    assert.equal(patchRes.statusCode, 200)
    assert.equal(await readFile(tmpFile, 'utf8'), 'Davor.\n\nVollständig.\n')
  })

  it('keeps comment ranges byte for byte: single-line, multi-line, at the start and at EOF', async () => {
    const cases = [
      '<!-- Kommentar -->\n\nDanach.\n',
      'Davor.\n\n<!--\na\nb\n-->\n\nDanach.\n',
      'Davor.\n\n<!-- Kommentar -->',
    ] as const
    for (const content of cases) {
      await writeFile(tmpFile, content, 'utf-8')
      const blocks = parseBlocks(content)
      const commentIndex = blocks.findIndex((block) => (block as { type: string }).type === 'commentBlock')
      const ids = registerMarkantoBlocks(content)
      const id = ids[commentIndex]!
      const raw = content.slice(blocks[commentIndex]!.start!, blocks[commentIndex]!.end! - 1)

      const getRes = mockRes()
      await handleGet(mockReq('GET', `/__hadley/block/${id}`), getRes)
      assert.equal(JSON.parse(getRes.body).text, raw)

      const patchRes = mockRes()
      await handlePatch(
        mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: raw }), {
          'content-type': 'application/json',
        }),
        patchRes,
      )
      const expected = content.endsWith('\n') ? content : content + '\n'
      assert.equal(await readFile(tmpFile, 'utf8'), expected)
    }
  })

  it('splices a multi-line comment PATCH exactly and leaves both neighbours untouched', async () => {
    const content = 'Davor.\n\n<!--\na\nb\n-->\n\nDanach.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [, id] = registerMarkantoBlocks(content)
    const res = mockRes()
    await handlePatch(
      mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: id, newText: '<!--\nneu\nmehrzeilig\n-->' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(await readFile(tmpFile, 'utf8'), 'Davor.\n\n<!--\nneu\nmehrzeilig\n-->\n\nDanach.\n')
  })

  it('moves a paragraph and a comment in both directions without losing text', async () => {
    let content = 'Eins.\n\n<!-- intern -->\n\nDrei.\n'
    await writeFile(tmpFile, content, 'utf-8')
    let ids = registerMarkantoBlocks(content)
    let res = mockRes()
    await handleMove(
      mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: ids[0], direction: 'down' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), '<!-- intern -->\n\nEins.\n\nDrei.\n')

    content = await readFile(tmpFile, 'utf8')
    ids = registerMarkantoBlocks(content)
    res = mockRes()
    await handleMove(
      mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: ids[0], direction: 'down' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), 'Eins.\n\n<!-- intern -->\n\nDrei.\n')
  })

  it('deleting a comment or its paragraph neighbour keeps the other text byte for byte', async () => {
    let content = 'Davor.\n\n<!-- intern -->\n\nDanach.\n'
    await writeFile(tmpFile, content, 'utf-8')
    let ids = registerMarkantoBlocks(content)
    let res = mockRes()
    await handleDelete(
      mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: ids[1] }), { 'content-type': 'application/json' }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), 'Davor.\n\nDanach.\n')

    content = 'Davor.\n\n<!-- intern -->\n\nDanach.\n'
    await writeFile(tmpFile, content, 'utf-8')
    ids = registerMarkantoBlocks(content)
    res = mockRes()
    await handleDelete(
      mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: ids[0] }), { 'content-type': 'application/json' }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), '<!-- intern -->\n\nDanach.\n')
  })

  it('refuses to merge a comment, which is not a text block', async () => {
    const content = '<!-- intern -->\n\nAbsatz.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [id] = registerMarkantoBlocks(content)
    const res = mockRes()
    await handleMerge(
      mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id, direction: 'down' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(res.statusCode, 400)
    assert.equal(await readFile(tmpFile, 'utf8'), content)
  })

  it('swap, merge and delete work with Markanto offsets', async () => {
    let content = 'Eins.\n\nZwei.\n\nDrei.\n'
    await writeFile(tmpFile, content, 'utf-8')
    let ids = registerMarkantoBlocks(content)
    let res = mockRes()
    await handleMove(
      mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: ids[1], direction: 'up' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), 'Zwei.\n\nEins.\n\nDrei.\n')

    content = await readFile(tmpFile, 'utf8')
    ids = registerMarkantoBlocks(content)
    res = mockRes()
    await handleMerge(
      mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: ids[0], direction: 'down' }), {
        'content-type': 'application/json',
      }),
      res,
    )
    assert.equal(await readFile(tmpFile, 'utf8'), 'Zwei.\nEins.\n\nDrei.\n')

    content = await readFile(tmpFile, 'utf8')
    ids = registerMarkantoBlocks(content)
    res = mockRes()
    await handleDelete(
      mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: ids[1] }), { 'content-type': 'application/json' }),
      res,
    )
    // Deleting the last block keeps the blank line before it, as the editor's
    // contract says (trim forwards only).
    assert.equal(await readFile(tmpFile, 'utf8'), 'Zwei.\nEins.\n\n')
  })
})

// ─── GET /__hadley/block/:blockId ──────────────────────────────────────────────

describe('GET /__hadley/block/:blockId', () => {
  it('returns the block text', async () => {
    const frontmatter = '---\ntitle: Test\n---\n\n' // length = 21
    const body = 'Erster Absatz.\n\nZweiter Absatz.\n'
    const content = frontmatter + body
    await writeFile(tmpFile, content, 'utf-8')

    const blocks = parseBlocks(content)
    const startToId = new Map<number, string>()
    for (const b of blocks) {
      if (b.start === undefined) continue
      const id = crypto.randomUUID()
      startToId.set(b.start, id)
      blockIdMap.set(id, { filePath: tmpFile, start: b.start, end: b.end!, fileHashAtRender: hash(content) })
    }
    const [, second] = blocks
    const blockId = startToId.get(second.start!)!

    const req = mockReq('GET', `/__hadley/block/${blockId}`)
    const res = mockRes()
    await handleGet(req, res)

    assert.equal(res.statusCode, 200)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.text, 'Zweiter Absatz.')
  })

  // review 2026-10-29: opening took the changed file's hash as the baseline and kept the offsets of the old one, so
  // a save wrote over the wrong text
  it('409 on opening a block of a file that changed since the page was rendered', async () => {
    for (const end of ['\n', '\r\n']) {
      const rendered = ['One.', '', 'Two.', '', 'Three.', ''].join(end)
      await writeFile(tmpFile, rendered, 'utf-8')
      const [, two] = registerMarkantoBlocks(rendered)
      const changed = ['Two.', '', 'Three.', ''].join(end)
      await writeFile(tmpFile, changed, 'utf-8')

      const res = mockRes()
      await handleGet(mockReq('GET', `/__hadley/block/${two}`), res)
      assert.equal(res.statusCode, 409)
      const patchRes = mockRes()
      await handlePatch(
        mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId: two, newText: 'Changed.' }), {
          'content-type': 'application/json',
        }),
        patchRes,
      )
      assert.equal(patchRes.statusCode, 409)
      assert.equal(await readFile(tmpFile, 'utf8'), changed)
    }
  })

  it('404 for an unknown blockId', async () => {
    const req = mockReq('GET', '/__hadley/block/nicht-vorhanden')
    const res = mockRes()
    await handleGet(req, res)
    assert.equal(res.statusCode, 404)
  })
})

// ─── POST /__hadley/patch ──────────────────────────────────────────────────────

describe('POST /__hadley/patch', () => {
  it('writes the patched content', async () => {
    const content = 'Erster.\n\nAlter Text.\n\nDritter.\n'
    await writeFile(tmpFile, content, 'utf-8')

    const blocks = parseBlocks(content)
    const second = blocks[1]
    const blockId = crypto.randomUUID()
    blockIdMap.set(blockId, {
      filePath: tmpFile,
      start: second.start!,
      end: second.end!,
      fileHashAtRender: hash(content),
    })

    const body = JSON.stringify({ blockId, newText: 'Neuer Text.' })
    const req = mockReq('POST', '/__hadley/patch', body, { 'content-type': 'application/json' })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true })

    const written = await readFile(tmpFile, 'utf8')
    assert.equal(written, 'Erster.\n\nNeuer Text.\n\nDritter.\n')
  })

  // review 2026-10-29: two writes at once both passed the hash check, and the second wrote over the first
  it('takes two changes at once one after the other: the second meets a changed file', async () => {
    const content = 'Eins.\n\nZwei.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [one, two] = registerMarkantoBlocks(content)
    const patch = (blockId: string, newText: string) => {
      const res = mockRes()
      // the mock sends its body at once; a real request holds it until it is read
      const body = JSON.stringify({ blockId, newText })
      return oneAtATime(() =>
        handlePatch(mockReq('POST', '/__hadley/patch', body, { 'content-type': 'application/json' }), res),
      ).then(() => res.statusCode)
    }
    const codes = await Promise.all([patch(one!, 'Erstens.'), patch(two!, 'Zweitens.')])
    assert.deepEqual(codes, [200, 409])
    assert.equal(await readFile(tmpFile, 'utf8'), 'Erstens.\n\nZwei.\n')
  })

  // review 2026-10-29: the writes wait for each other, so a body that never ended held every write after it
  it('gives up on a body that does not arrive in time', async () => {
    const never = new Readable({ read() {} }) as unknown as IncomingMessage
    await assert.rejects(readBody(never, 'en', 1_048_576, 50), /did not arrive in time/)
  })

  it('409 on a hash mismatch (file changed elsewhere)', async () => {
    const content = 'Alter Inhalt.\n'
    await writeFile(tmpFile, content, 'utf-8')

    const blockId = crypto.randomUUID()
    // Fill the map with a wrong hash
    blockIdMap.set(blockId, { filePath: tmpFile, start: 0, end: 14, fileHashAtRender: 'falscher-hash' })

    const body = JSON.stringify({ blockId, newText: 'Neuer Inhalt.' })
    const req = mockReq('POST', '/__hadley/patch', body, { 'content-type': 'application/json' })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 409)
  })

  it('422 for broken Markdown after the patch — the file stays unchanged', async () => {
    const content = 'Alter Text.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [block] = parseBlocks(content)
    const blockId = crypto.randomUUID()
    blockIdMap.set(blockId, {
      filePath: tmpFile,
      start: block.start!,
      end: block.end!,
      fileHashAtRender: hash(content),
    })

    const req = mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId, newText: ':::' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 422)
    assert.equal(await readFile(tmpFile, 'utf8'), content)
    const body = JSON.parse(res.body)
    assert.equal(body.errors.length, 1)
    assert.equal(body.errors[0].local, true)
  })

  it('200 despite an existing error in ANOTHER block — the edit itself is clean', async () => {
    // The broken <m> wrapper stays confined to its own block (it swallows none of the
    // blocks after it) — "Absatz drei." stays a block of its own that can be edited.
    // The edit is to "Absatz eins.", not to the broken block — since it was relaxed,
    // the gate blocks only on errors in the edited block.
    const content = 'Absatz eins.\n\n<m>kaputt\n\nAbsatz drei.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [first] = parseBlocks(content)
    const blockId = crypto.randomUUID()
    blockIdMap.set(blockId, {
      filePath: tmpFile,
      start: first.start!,
      end: first.end!,
      fileHashAtRender: hash(content),
    })

    const req = mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId, newText: 'Absatz eins geändert.' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 200)
    assert.equal(await readFile(tmpFile, 'utf8'), 'Absatz eins geändert.\n\n<m>kaputt\n\nAbsatz drei.\n')
  })

  it('422 marks an error in the edited block itself as local — and still blocks', async () => {
    const content = 'Absatz eins.\n\nAbsatz zwei.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [first] = parseBlocks(content)
    const blockId = crypto.randomUUID()
    blockIdMap.set(blockId, {
      filePath: tmpFile,
      start: first.start!,
      end: first.end!,
      fileHashAtRender: hash(content),
    })

    const req = mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId, newText: '<m>kaputt' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 422)
    assert.equal(await readFile(tmpFile, 'utf8'), content)
    const body = JSON.parse(res.body)
    assert.equal(body.errors.length, 1)
    assert.equal(body.errors[0].message, 'unclosed metadata wrapper')
    assert.equal(body.errors[0].local, true)
  })

  it('normalizes a trailing \\n in newText', async () => {
    const content = 'Alt.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const [block] = parseBlocks(content)
    const blockId = crypto.randomUUID()
    blockIdMap.set(blockId, {
      filePath: tmpFile,
      start: block.start!,
      end: block.end!,
      fileHashAtRender: hash(content),
    })

    // The textarea sends newText with a trailing \n (the user pressed Enter)
    const req = mockReq('POST', '/__hadley/patch', JSON.stringify({ blockId, newText: 'Neu.\n\n' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handlePatch(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    // Exactly one \n at the end, no \n\n
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Neu.\n')
  })

  it('404 for an unknown blockId', async () => {
    const body = JSON.stringify({ blockId: 'ghost', newText: 'Text.' })
    const req = mockReq('POST', '/__hadley/patch', body, { 'content-type': 'application/json' })
    const res = mockRes()
    await handlePatch(req, res)
    assert.equal(res.statusCode, 404)
  })

  it('400 when newText is not a string', async () => {
    const body = JSON.stringify({ blockId: 'x', newText: 42 })
    const req = mockReq('POST', '/__hadley/patch', body, { 'content-type': 'application/json' })
    const res = mockRes()
    await handlePatch(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('415 for a wrong Content-Type', async () => {
    const body = JSON.stringify({ blockId: 'x', newText: 'y' })
    const req = mockReq('POST', '/__hadley/patch', body, { 'content-type': 'text/plain' })
    const res = mockRes()
    await handlePatch(req, res)
    assert.equal(res.statusCode, 415)
  })

  it('400 for invalid JSON', async () => {
    const req = mockReq('POST', '/__hadley/patch', '{kaputt}', { 'content-type': 'application/json' })
    const res = mockRes()
    await handlePatch(req, res)
    assert.equal(res.statusCode, 400)
  })
})

// ─── Patch formula ────────────────────────────────────────────────────────────

describe('patch formula', () => {
  it('replaces a block in the middle of the document', () => {
    const content = 'Erster.\n\nAlter Text.\n\nDritter.\n'
    const blocks = parseBlocks(content)
    const second = blocks[1]
    const patched = content.slice(0, second.start!) + 'Neuer Text.' + '\n' + content.slice(second.end!)
    assert.equal(patched, 'Erster.\n\nNeuer Text.\n\nDritter.\n')
  })

  it('replaces the first block', () => {
    const content = 'Erster.\n\nZweiter.\n'
    const [first] = parseBlocks(content)
    const patched = content.slice(0, first.start!) + 'Ersetzt.' + '\n' + content.slice(first.end!)
    assert.equal(patched, 'Ersetzt.\n\nZweiter.\n')
  })

  it('replaces the last block', () => {
    const content = 'Erster.\n\nLetzter.\n'
    const [, last] = parseBlocks(content)
    const patched = content.slice(0, last.start!) + 'Neu.' + '\n' + content.slice(last.end!)
    assert.equal(patched, 'Erster.\n\nNeu.\n')
  })
})

// ─── POST /__hadley/delete ─────────────────────────────────────────────────────

describe('POST /__hadley/delete', () => {
  async function setupBlock(content: string, blockIndex = 0) {
    await writeFile(tmpFile, content, 'utf-8')
    const blocks = parseBlocks(content)
    const block = blocks[blockIndex]
    const id = crypto.randomUUID()
    blockIdMap.set(id, {
      filePath: tmpFile,
      start: block.start!,
      end: block.end!,
      fileHashAtRender: hash(content),
    })
    return id
  }

  it('deletes a block', async () => {
    const content = 'Erster.\n\nZweiter.\n'
    const id = await setupBlock(content, 0)

    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: id }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    const written = await readFile(tmpFile, 'utf-8')
    assert.equal(written, 'Zweiter.\n')
  })

  it('removes the following blank line when there is one', async () => {
    const content = 'Erster.\n\nZweiter.\n'
    const id = await setupBlock(content, 0)

    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: id }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    const { readFile } = await import('node:fs/promises')
    const written = await readFile(tmpFile, 'utf-8')
    // The blank line between Erster and Zweiter goes too
    assert.ok(!written.includes('\n\n'))
    assert.equal(written, 'Zweiter.\n')
  })

  it('deletes the middle block (three blocks)', async () => {
    // The middle block and the blank line after it are removed
    const content = 'Erster.\n\nMittlerer.\n\nLetzter.\n'
    const id = await setupBlock(content, 1)

    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: id }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    const { readFile } = await import('node:fs/promises')
    const written = await readFile(tmpFile, 'utf-8')
    assert.equal(written, 'Erster.\n\nLetzter.\n')
  })

  it('deletes the last block — the blank line before it stays (spec: trim forwards only)', async () => {
    // By the spec only a blank line AFTER end is removed; the last block has none
    const content = 'Erster.\n\nLetzter.\n'
    const id = await setupBlock(content, 1)

    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: id }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    const { readFile } = await import('node:fs/promises')
    const written = await readFile(tmpFile, 'utf-8')
    // Erster.\n + \n (the separating line stays)
    assert.equal(written, 'Erster.\n\n')
  })

  it('409 on a hash mismatch', async () => {
    const content = 'Original.\n'
    const id = await setupBlock(content, 0)
    blockIdMap.get(id)!.fileHashAtRender = hash('anderer Inhalt')

    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: id }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    assert.equal(res.statusCode, 409)
  })

  it('404 for an unknown blockId', async () => {
    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: 'unbekannt' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()

    await handleDelete(req, res)

    assert.equal(res.statusCode, 404)
  })

  it('415 for a wrong Content-Type', async () => {
    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({ blockId: 'x' }), { 'content-type': 'text/plain' })
    const res = mockRes()

    await handleDelete(req, res)

    assert.equal(res.statusCode, 415)
  })

  it('400 when blockId is missing', async () => {
    const req = mockReq('POST', '/__hadley/delete', JSON.stringify({}), { 'content-type': 'application/json' })
    const res = mockRes()

    await handleDelete(req, res)

    assert.equal(res.statusCode, 400)
  })
})

// ─── POST /__hadley/move ───────────────────────────────────────────────────────

describe('POST /__hadley/move', () => {
  async function setupBlocks(content: string): Promise<string[]> {
    await writeFile(tmpFile, content, 'utf-8')
    const blocks = parseBlocks(content)
    const h = hash(content)
    return blocks.map((b) => {
      const id = crypto.randomUUID()
      blockIdMap.set(id, { filePath: tmpFile, start: b.start!, end: b.end!, fileHashAtRender: h })
      return id
    })
  }

  it('moves the first block down', async () => {
    const [id0] = await setupBlocks('Erster.\n\nZweiter.\n')

    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id0, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Zweiter.\n\nErster.\n')
  })

  it('moves the second block up', async () => {
    const [, id1] = await setupBlocks('Erster.\n\nZweiter.\n')

    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id1, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Zweiter.\n\nErster.\n')
  })

  it('keeps the separator when it moves the middle one of three blocks', async () => {
    const [, id1] = await setupBlocks('Erster.\n\nMittlerer.\n\nLetzter.\n')

    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id1, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Mittlerer.\n\nErster.\n\nLetzter.\n')
  })

  it('400 — first block up', async () => {
    const [id0] = await setupBlocks('Erster.\n\nZweiter.\n')
    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id0, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('400 — last block down', async () => {
    const [, id1] = await setupBlocks('Erster.\n\nZweiter.\n')
    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id1, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('400 — invalid direction', async () => {
    const [id0] = await setupBlocks('Erster.\n\nZweiter.\n')
    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id0, direction: 'left' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('409 — hash mismatch', async () => {
    const [id0] = await setupBlocks('Erster.\n\nZweiter.\n')
    blockIdMap.get(id0)!.fileHashAtRender = hash('anderer Inhalt')
    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: id0, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)
    assert.equal(res.statusCode, 409)
  })

  it('404 — unknown blockId', async () => {
    const req = mockReq('POST', '/__hadley/move', JSON.stringify({ blockId: 'x', direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMove(req, res)
    assert.equal(res.statusCode, 404)
  })
})

// ─── POST /__hadley/merge ──────────────────────────────────────────────────────

describe('POST /__hadley/merge', () => {
  async function setupParagraphs(content: string): Promise<string[]> {
    await writeFile(tmpFile, content, 'utf-8')
    const blocks = parseBlocks(content)
    const h = hash(content)
    return blocks.map((b) => {
      const id = crypto.randomUUID()
      blockIdMap.set(id, {
        filePath: tmpFile,
        start: b.start!,
        end: b.end!,
        fileHashAtRender: h,
        isParagraph: b.type === 'paragraph',
      })
      return id
    })
  }

  it('merges two paragraphs (merge down)', async () => {
    const [id0] = await setupParagraphs('Erster.\n\nZweiter.\n')

    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id0, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Erster.\nZweiter.\n')
  })

  it('merges two paragraphs (merge up)', async () => {
    const [, id1] = await setupParagraphs('Erster.\n\nZweiter.\n')

    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id1, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Erster.\nZweiter.\n')
  })

  it('keeps the surrounding content (three paragraphs, the middle one merged up)', async () => {
    const [, id1] = await setupParagraphs('Erster.\n\nMittlerer.\n\nLetzter.\n')

    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id1, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)

    assert.equal(res.statusCode, 200)
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(tmpFile, 'utf-8'), 'Erster.\nMittlerer.\n\nLetzter.\n')
  })

  it('400 when the block is not a paragraph', async () => {
    const content = '## Überschrift\n\nAbsatz.\n'
    await writeFile(tmpFile, content, 'utf-8')
    const blocks = parseBlocks(content)
    const h = hash(content)
    const ids = blocks.map((b) => {
      const id = crypto.randomUUID()
      blockIdMap.set(id, {
        filePath: tmpFile,
        start: b.start!,
        end: b.end!,
        fileHashAtRender: h,
        isParagraph: b.type === 'paragraph',
      })
      return id
    })

    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: ids[0], direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)

    assert.equal(res.statusCode, 400)
  })

  it('400 when the neighbour is not a paragraph', async () => {
    const content = 'Absatz.\n\n## Überschrift\n'
    await writeFile(tmpFile, content, 'utf-8')
    const blocks = parseBlocks(content)
    const h = hash(content)
    const ids = blocks.map((b) => {
      const id = crypto.randomUUID()
      blockIdMap.set(id, {
        filePath: tmpFile,
        start: b.start!,
        end: b.end!,
        fileHashAtRender: h,
        isParagraph: b.type === 'paragraph',
      })
      return id
    })

    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: ids[0], direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)

    assert.equal(res.statusCode, 400)
  })

  it('400 — first block merged up', async () => {
    const [id0] = await setupParagraphs('Erster.\n\nZweiter.\n')
    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id0, direction: 'up' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('400 — last block merged down', async () => {
    const [, id1] = await setupParagraphs('Erster.\n\nZweiter.\n')
    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id1, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)
    assert.equal(res.statusCode, 400)
  })

  it('409 — hash mismatch', async () => {
    const [id0] = await setupParagraphs('Erster.\n\nZweiter.\n')
    blockIdMap.get(id0)!.fileHashAtRender = hash('anderer Inhalt')
    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: id0, direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)
    assert.equal(res.statusCode, 409)
  })

  it('404 — unknown blockId', async () => {
    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: 'x', direction: 'down' }), {
      'content-type': 'application/json',
    })
    const res = mockRes()
    await handleMerge(req, res)
    assert.equal(res.statusCode, 404)
  })

  it('415 for a wrong Content-Type', async () => {
    const req = mockReq('POST', '/__hadley/merge', JSON.stringify({ blockId: 'x', direction: 'down' }), {
      'content-type': 'text/plain',
    })
    const res = mockRes()
    await handleMerge(req, res)
    assert.equal(res.statusCode, 415)
  })
})

// ─── registerPageBlocks + blockIdMap ──────────────────────────────────────────

describe('registerPageBlocks', () => {
  it('registers the blocks and returns a getBlockId that matches them', () => {
    const rawDoc = '---\ntitle: T\n---\n\nAbsatz eins.\n\nAbsatz zwei.\n'
    const blocks = parseBlocks(rawDoc)

    const getBlockId = registerPageBlocks(blocks, rawDoc, '/fake/path.md')

    assert.equal(blockIdMap.size, 2)
    for (const block of blocks) {
      const id = getBlockId(block.start!)
      assert.equal(typeof id, 'string')
      assert.equal(blockIdMap.has(id!), true)
    }
  })

  it('drops the old entries of the same file on a rebuild', () => {
    const rawDoc = 'Absatz.\n'
    const blocks = parseBlocks(rawDoc)
    registerPageBlocks(blocks, rawDoc, '/fake/a.md')
    const firstSize = blockIdMap.size

    registerPageBlocks(blocks, rawDoc, '/fake/a.md')
    assert.equal(blockIdMap.size, firstSize) // no duplicates
  })
})
