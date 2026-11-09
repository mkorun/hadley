// A stand-in for `claude -p` with stream-json (agents/claude.ts), for the tests: it answers each message with
// "echo: <text>", asks to use Bash where the text says TOOL, ends with code 3 where it says CRASH, and continues a
// session it knows, the one --resume names, unless that is all zeros.
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : undefined
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const session = resume ?? '11111111-1111-4111-8111-111111111111'
let started = false
let waiting

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.type === 'control_response') {
    const { response } = message.response
    out({
      type: 'result',
      subtype: 'success',
      result: response.behavior === 'allow' ? 'allowed' : `denied: ${response.message}`,
    })
    waiting = undefined
    continue
  }
  if (message.type !== 'user') continue
  if (resume === '00000000-0000-4000-8000-000000000000') {
    out({ type: 'result', subtype: 'error_during_execution', session_id: resume })
    process.exit(1)
  }
  if (!started) out({ type: 'system', subtype: 'init', session_id: session })
  started = true
  const text = message.message.content
  if (text.includes('CRASH')) process.exit(3)
  if (text.includes('TOOL')) {
    waiting = 'req-1'
    out({
      type: 'control_request',
      request_id: waiting,
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls -1' }, description: 'List files' },
    })
    continue
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } })
  out({ type: 'result', subtype: 'success', result: `echo: ${text.split('\n')[1]}` })
}
