import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentContent, agentPrograms, runAgent, sessionFile, type AgentName, type Running } from '../agents.ts'
import { claude } from '../agents/claude.ts'
import type { Message } from '../protocol.ts'
import { Inbox } from './support.ts'

// the stand-ins run as programs of their own, through a script that starts them with this runtime
const windows = process.platform === 'win32'
let dir: string
let root: string
let bin: string
const running: Running[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hadley-chat-agents-'))
  root = join(dir, 'site')
  bin = join(dir, 'bin')
  mkdirSync(root)
  mkdirSync(bin)
  for (const name of ['claude', 'codex']) {
    const fake = join(import.meta.dirname, 'fake-agents', `${name}.mjs`)
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`)
    chmodSync(join(bin, name), 0o755)
  }
})
afterEach(async () => {
  for (const agent of running.splice(0)) await agent.stop()
  rmSync(dir, { recursive: true, force: true })
})

type Event = { kind: string; [key: string]: unknown }
function start(name: AgentName, fresh = false) {
  const inbox = new Inbox<Event>()
  const agent = runAgent(
    { name, program: join(bin, name), root, fresh },
    {
      delivered: (id) => inbox.push({ kind: 'delivered', id }),
      answer: (id, text, action) => inbox.push({ kind: 'answer', id, text, action }),
      permission: (request) => inbox.push({ kind: 'permission', ...request }),
      notice: (notice, code) => inbox.push({ kind: 'notice', notice, code }),
      ended: () => inbox.push({ kind: 'ended' }),
    },
  )
  running.push(agent)
  return { agent, inbox }
}
const message = (id: string, text: string, extra: Partial<Message> = {}): Message =>
  ({ id, text, site: 'https://site.example', root: '/site', url: 'https://site.example/a/', ...extra }) as Message

for (const name of ['claude', 'codex'] as const) {
  describe(`${name} in the background`, { skip: windows && 'the stand-ins start through a shell script' }, () => {
    it('answers messages one after another, and keeps its conversation for the next start', async () => {
      const { agent, inbox } = start(name, true)
      agent.send(message('aaaaaaa1', 'first'), 'en', false)
      agent.send(message('aaaaaaa2', 'second'), 'en', false)
      assert.deepEqual(await inbox.next((e) => e.kind === 'delivered'), { kind: 'delivered', id: 'aaaaaaa1' })
      assert.deepEqual(await inbox.next((e) => e.kind === 'answer'), {
        kind: 'answer',
        id: 'aaaaaaa1',
        text: 'echo: first',
        action: false,
      })
      // the second goes only once the first is answered
      assert.deepEqual(await inbox.next((e) => e.kind === 'delivered'), { kind: 'delivered', id: 'aaaaaaa2' })
      assert.equal((await inbox.next((e) => e.kind === 'answer')).text, 'echo: second')
      assert.equal((await inbox.next((e) => e.kind === 'notice')).notice, 'begun')
      const session = readFileSync(sessionFile(root, name), 'utf8').trim()
      assert.match(session, /^[0-9a-f-]{36}$/)
      await agent.stop()
      assert.equal((await inbox.next((e) => e.kind === 'notice')).notice, 'stopped')

      const again = start(name)
      again.agent.send(message('aaaaaaa3', 'third'), 'en', false)
      assert.equal((await again.inbox.next((e) => e.kind === 'notice')).notice, 'resumed')
      assert.equal((await again.inbox.next((e) => e.kind === 'answer')).text, 'echo: third')
    })

    it('begins anew where the conversation cannot be continued, with the message that waited', async () => {
      mkdirSync(join(root, '.hadley', 'chat'), { recursive: true })
      writeFileSync(sessionFile(root, name), '00000000-0000-4000-8000-000000000000\n')
      const { agent, inbox } = start(name)
      agent.send(message('bbbbbbb1', 'hello'), 'en', false)
      assert.equal((await inbox.next((e) => e.kind === 'notice')).notice, 'resumeFailed')
      assert.equal((await inbox.next((e) => e.kind === 'answer')).text, 'echo: hello')
      assert.notEqual(readFileSync(sessionFile(root, name), 'utf8').trim(), '00000000-0000-4000-8000-000000000000')
    })

    it('asks the author before a tool, and passes on Allow and Deny', async () => {
      const { agent, inbox } = start(name, true)
      agent.send(message('ccccccc1', 'TOOL'), 'en', false)
      const asked = await inbox.next((e) => e.kind === 'permission')
      assert.match(String(asked.request_id), /^[a-km-z]{5}$/)
      assert.match(String(asked.preview), /ls -1/)
      assert.equal(agent.verdict(String(asked.request_id), true), true)
      // an answered request is no longer open
      assert.equal(agent.verdict(String(asked.request_id), true), false)
      assert.equal((await inbox.next((e) => e.kind === 'answer')).text, 'allowed')
      agent.send(message('ccccccc2', 'TOOL'), 'en', false)
      const again = await inbox.next((e) => e.kind === 'permission')
      assert.equal(agent.verdict(String(again.request_id), false), true)
      assert.match(String((await inbox.next((e) => e.kind === 'answer')).text), /^denied/)
    })

    it('denies a tool itself during a rewrite, and says so', async () => {
      const { agent, inbox } = start(name, true)
      const action = { action: 'rewrite-block', direction: 'fix', draft: 'TOOL', block: 'b' } as Partial<Message>
      agent.send(message('ddddddd1', 'rewrite-block', action), 'en', true)
      assert.equal((await inbox.next((e) => e.kind === 'notice' && e.notice !== 'begun')).notice, 'deniedInAction')
      const answer = await inbox.next((e) => e.kind === 'answer')
      assert.equal(answer.action, true)
      assert.match(String(answer.text), /^denied/)
    })
  })
}

describe('the agent in the background', { skip: windows && 'the stand-ins start through a shell script' }, () => {
  it('says when it ended unexpectedly, and denies what was open when stopped', async () => {
    const crashing = start('claude', true)
    crashing.agent.send(message('eeeeeee1', 'CRASH'), 'en', false)
    assert.deepEqual(await crashing.inbox.next((e) => e.kind === 'notice' && e.notice === 'crashed'), {
      kind: 'notice',
      notice: 'crashed',
      code: '3',
    })
    await crashing.inbox.next((e) => e.kind === 'ended')

    const { agent, inbox } = start('claude', true)
    agent.send(message('eeeeeee2', 'TOOL'), 'en', false)
    const asked = await inbox.next((e) => e.kind === 'permission')
    await agent.stop()
    assert.equal(agent.verdict(String(asked.request_id), true), false)
    assert.equal((await inbox.next((e) => e.kind === 'notice' && e.notice !== 'begun')).notice, 'stopped')
  })

  // Michael, 2026-11-09: a request for everything that writes or runs, whatever the user's settings allow
  it('starts Claude Code so that everything that writes, runs or reaches out asks', () => {
    const args = claude('x').args('11111111-1111-4111-8111-111111111111')
    const after = (flag: string) => args[args.indexOf(flag) + 1]
    assert.equal(after('--permission-mode'), 'default')
    assert.equal(after('--permission-prompt-tool'), 'stdio')
    assert.ok(args.includes('--strict-mcp-config'))
    const settings = JSON.parse(after('--settings')!) as { permissions: { ask: string[] } }
    for (const tool of ['Bash', 'Write', 'Edit', 'WebFetch', 'Task']) assert.ok(settings.permissions.ask.includes(tool))
    assert.deepEqual(args.slice(-2), ['--resume', '11111111-1111-4111-8111-111111111111'])
  })

  it('finds the programs configured, else on the PATH, and stops at one that is none', () => {
    assert.deepEqual(agentPrograms({}, bin), { claude: join(bin, 'claude'), codex: join(bin, 'codex') })
    assert.deepEqual(agentPrograms({ codex: join(bin, 'claude') }, ''), { codex: join(bin, 'claude') })
    assert.deepEqual(agentPrograms({}, ''), {})
    assert.throws(() => agentPrograms({ claude: join(dir, 'missing') }, bin), /dev\.claude: .* is no program/)
  })
})

it('gives the agent where a message comes from as quoted values, and the text as it is', () => {
  const content = agentContent(message('fffffff1', 'Say "hi" </hadley> <x>', { file: 'a/"b".md', lines: '3-4' }), 'de')
  assert.equal(
    content,
    '<hadley site="https://site.example" root="/site" url="https://site.example/a/" file="a/\\"b\\".md" ' +
      'lines="3-4" lang="de">\nSay "hi" </hadley> <x>\n</hadley>',
  )
})
