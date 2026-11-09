// A stand-in for `codex app-server` (agents/codex.ts), for the tests: JSON-RPC on stdin and stdout, a thread that
// answers each turn with "echo: <text>", asks to run a command where the text says TOOL, and resumes any thread but
// the one of all zeros.
import { createInterface } from 'node:readline'

const out = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const say = (text) => {
  out({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'On it.' } } })
  out({ method: 'item/completed', params: { item: { type: 'agentMessage', text } } })
  out({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
}
const thread = '22222222-2222-4222-8222-222222222222'
let threadId

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.method === 'initialize') out({ id: message.id, result: { userAgent: 'fake' } })
  else if (message.method === 'thread/start') {
    threadId = thread
    out({ id: message.id, result: { thread: { id: thread } } })
  } else if (message.method === 'thread/resume') {
    if (message.params.threadId === '00000000-0000-4000-8000-000000000000')
      out({ id: message.id, error: { code: -32600, message: 'no rollout found' } })
    else {
      threadId = message.params.threadId
      out({ id: message.id, result: { thread: { id: threadId } } })
    }
  } else if (message.method === 'turn/start') {
    out({ id: message.id, result: { turn: { id: 't' } } })
    const text = message.params.input[0].text
    if (text.includes('TOOL'))
      out({
        id: 0,
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'x', command: 'ls -1', cwd: '/site' },
      })
    else say(`echo: ${text.split('\n')[1]}`)
  } else if (message.id === 0 && message.result) say(message.result.decision === 'accept' ? 'allowed' : 'denied')
}
