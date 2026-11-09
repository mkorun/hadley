/**
 * Claude Code in the background (docs/dev-server.md, "Chat"): `claude -p` reads the author's messages as stream-json
 * on stdin and writes its turns on stdout; with `--permission-prompt-tool stdio` each request to use a tool comes as
 * a `can_use_tool` control request, which the panel answers (spike 2026-11-09, private/spikes/headless-chat). Every
 * tool that writes, runs, reaches the network or starts a subagent asks, whatever the user's settings allow: an `ask`
 * rule wins over an `allow` rule, and the permission mode is set here, not taken from the settings.
 */
import type { Adapter, AdapterEvents, Write } from '../agents.ts'

const ASK = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']

export function claude(instructions: string): Adapter {
  let write: Write = () => {}
  // the tool input of each open request, which an allow sends back unchanged
  const inputs = new Map<string, unknown>()
  // the texts of the turn so far, in case its result carries none
  let texts: string[] = []
  let started = false
  return {
    args: (session) => [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--permission-prompts',
      'host',
      '--permission-prompt-tool',
      'stdio',
      '--settings',
      JSON.stringify({ permissions: { ask: ASK } }),
      '--strict-mcp-config',
      '--append-system-prompt',
      instructions,
      ...(session ? ['--resume', session] : []),
    ],
    open(writer) {
      write = writer
    },
    send(text) {
      texts = []
      write({ type: 'user', message: { role: 'user', content: text } })
    },
    answer(ref, allow) {
      const input = inputs.get(ref)
      inputs.delete(ref)
      write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: ref,
          response: allow
            ? { behavior: 'allow', updatedInput: input ?? {} }
            : { behavior: 'deny', message: 'The author denied this in the editor.' },
        },
      })
    },
    read(event, on: AdapterEvents) {
      if (typeof event !== 'object' || event === null) return
      const record = event as Record<string, any>
      if (record.type === 'system' && record.subtype === 'init' && typeof record.session_id === 'string') {
        started = true
        on.session(record.session_id)
      } else if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const part of record.message.content)
          if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text)
      } else if (record.type === 'control_request' && record.request?.subtype === 'can_use_tool') {
        const { request_id: ref, request } = record
        if (typeof ref !== 'string' || typeof request.tool_name !== 'string') return
        inputs.set(ref, request.input)
        const described = typeof request.description === 'string' && request.description.trim()
        on.permission(ref, {
          tool: request.tool_name,
          description: described ? request.description : request.tool_name,
          preview: preview(request.tool_name, request.input),
        })
      } else if (record.type === 'result') {
        // a conversation it cannot continue ends before it starts, with an error for a result (agents.ts starts anew)
        if (!started) return
        const text = typeof record.result === 'string' && record.result.trim() ? record.result : texts.join('\n\n')
        texts = []
        on.answer(text)
      }
    },
  }
}

/** What the author sees of a request before allowing it: the command, the file and its new text, or the input. */
function preview(tool: string, input: unknown): string {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  if (tool === 'Bash' && typeof record.command === 'string') return record.command
  if (tool === 'Write' && typeof record.file_path === 'string')
    return `${record.file_path}\n\n${typeof record.content === 'string' ? record.content : ''}`
  if (tool === 'Edit' && typeof record.file_path === 'string')
    return `${record.file_path}\n\n- ${String(record.old_string ?? '')}\n+ ${String(record.new_string ?? '')}`
  return JSON.stringify(input ?? {}, null, 2)
}
