/**
 * Codex in the background (docs/dev-server.md, "Chat"): `codex app-server` speaks JSON-RPC 2.0, a message on each line
 * of stdin and stdout. A thread in the site's directory takes a turn for each of the author's messages; its requests to
 * change a file or run a command come as requests of the server, which the panel answers (spike 2026-11-09,
 * private/spikes/headless-chat). `untrusted` asks for every command and every change, in a sandbox that writes only in
 * the site and reaches no network.
 */
import type { Adapter, AdapterEvents, Write } from '../agents.ts'

type Call = 'initialize' | 'start' | 'resume' | 'turn'

export function codex(instructions: string, root: string): Adapter {
  const thread = {
    cwd: root,
    approvalPolicy: 'untrusted',
    sandbox: 'workspace-write',
    developerInstructions: instructions,
  }
  let next = 1
  // what each of our requests was for
  const calls = new Map<number, Call>()
  let write: Write = () => {}
  let threadId: string | undefined
  let resuming: string | undefined
  // a message sent before the thread stood
  let waiting: string | undefined
  // the last thing Codex said in this turn: its answer (what it said before is on the way there)
  let last = ''
  // the files a change is about to touch, by its item, for the request that follows
  const changes = new Map<string, string>()
  const call = (method: string, params: unknown, kind: Call) => {
    const id = next++
    calls.set(id, kind)
    write({ jsonrpc: '2.0', id, method, params })
  }
  const turn = (text: string) => {
    last = ''
    call('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] }, 'turn')
  }
  return {
    args: () => ['app-server'],
    open(writer, session) {
      write = writer
      resuming = session
      call(
        'initialize',
        { clientInfo: { name: 'hadley', title: 'hadley', version: '1' }, capabilities: null },
        'initialize',
      )
    },
    send(text) {
      if (threadId) turn(text)
      else waiting = text
    },
    answer(ref, allow) {
      write({ jsonrpc: '2.0', id: JSON.parse(ref) as unknown, result: { decision: allow ? 'accept' : 'decline' } })
    },
    read(event, on: AdapterEvents) {
      if (typeof event !== 'object' || event === null) return
      const message = event as Record<string, any>
      if (message.id !== undefined && message.method === undefined) {
        const kind = calls.get(message.id)
        calls.delete(message.id)
        if (kind === 'initialize') {
          write({ jsonrpc: '2.0', method: 'initialized' })
          if (resuming) call('thread/resume', { threadId: resuming, ...thread }, 'resume')
          else call('thread/start', thread, 'start')
        } else if (kind === 'start' || kind === 'resume') {
          const id = message.result?.thread?.id
          if (kind === 'resume' && (message.error || typeof id !== 'string')) {
            resuming = undefined
            on.resumeFailed()
            call('thread/start', thread, 'start')
            return
          }
          if (typeof id !== 'string') throw new Error('codex: thread/start gave no thread')
          threadId = id
          on.session(id)
          if (waiting !== undefined) turn(waiting)
          waiting = undefined
        } else if (kind === 'turn' && message.error) on.answer('')
        return
      }
      const params = message.params ?? {}
      if (message.id !== undefined) {
        // a request of the server: an approval, by its JSON-RPC id
        const ref = JSON.stringify(message.id)
        const reason = typeof params.reason === 'string' && params.reason ? params.reason : undefined
        if (message.method === 'item/commandExecution/requestApproval')
          on.permission(ref, {
            tool: 'Shell',
            description: reason ?? 'Run a command',
            preview: `${String(params.command ?? '')}${params.cwd ? `\n\nin ${String(params.cwd)}` : ''}`,
          })
        else if (message.method === 'item/fileChange/requestApproval') {
          const preview = changes.get(String(params.itemId)) ?? ''
          changes.delete(String(params.itemId))
          on.permission(ref, { tool: 'Edit', description: reason ?? 'Change files', preview })
        }
        // anything else it may ask, hadley does not offer
        else write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not offered by hadley' } })
        return
      }
      const item = params.item
      if (message.method === 'item/started' && item?.type === 'fileChange' && Array.isArray(item.changes))
        changes.set(
          String(item.id),
          item.changes
            .map(
              (change: any) =>
                `${String(change?.path ?? '')}${typeof change?.diff === 'string' ? `\n${change.diff}` : ''}`,
            )
            .join('\n\n'),
        )
      else if (message.method === 'item/completed' && item?.type === 'agentMessage') {
        if (typeof item.text === 'string' && item.text.trim()) last = item.text
      } else if (message.method === 'turn/completed') {
        const text = last
        last = ''
        on.answer(text)
      }
    },
  }
}
