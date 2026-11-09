// What the dev server's chat sends over its event stream (addons/chat/plugin.ts), checked once at the boundary: never
// a missing field inferred, never a value of another kind taken. No DOM, so that it is tested on its own.

// the agents the dev server can start itself (addons/chat/agents.ts), by name and as the panel says them
export const AGENT_NAMES = ['claude', 'codex'] as const
export type AgentName = (typeof AGENT_NAMES)[number]
export const AGENT_TITLES: Record<AgentName, string> = { claude: 'Claude Code', codex: 'Codex' }
export const NOTICES = [
  'resumed',
  'resumeFailed',
  'begun',
  'stopped',
  'crashed',
  'startFailed',
  'deniedInAction',
] as const
export type Notice = (typeof NOTICES)[number]

export type Fields = Record<string, unknown>
export type EventName = 'message' | 'reply' | 'suggestion' | 'delivered' | 'permission' | 'status' | 'notice'

/** An event as the panel takes it: its kind, its fields, whether a permission is still open, and when it came. */
export interface Entry {
  event: EventName
  data: Fields
  open: boolean | undefined
  at: number
}

const FIELDS: Record<EventName, readonly string[]> = {
  message: ['id', 'text'],
  reply: ['id', 'text'],
  suggestion: ['id', 'to', 'text'],
  delivered: ['id'],
  permission: ['request_id', 'tool', 'description', 'preview'],
  status: [],
  notice: ['kind', 'agent'],
}

const isAgent = (name: unknown): name is AgentName => AGENT_NAMES.includes(name as AgentName)

/** Checks an event of the stream, or throws: SSE JSON is checked once, here. */
export function checkEntry(event: string, data: unknown, open: unknown, at: number = Date.now()): Entry {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('chat event')
  const fields = Object.hasOwn(FIELDS, event) ? FIELDS[event as EventName] : undefined
  const record = data as Fields
  if (!fields || fields.some((key) => typeof record[key] !== 'string')) throw new Error('chat event fields')
  if (event === 'reply' && record['to'] !== undefined && typeof record['to'] !== 'string') throw new Error('reply to')
  if (
    event === 'status' &&
    (typeof record['connected'] !== 'boolean' ||
      (record['agent'] !== undefined && (typeof record['agent'] !== 'string' || record['agent'].length > 64)) ||
      (record['background'] !== undefined && !isAgent(record['background'])) ||
      (record['available'] !== undefined &&
        (!Array.isArray(record['available']) || record['available'].some((name) => !isAgent(name)))))
  )
    throw new Error('status')
  if (
    event === 'notice' &&
    (!NOTICES.includes(record['kind'] as Notice) ||
      (record['agent'] as string).length > 64 ||
      (record['code'] !== undefined && (typeof record['code'] !== 'string' || record['code'].length > 64)))
  )
    throw new Error('notice')
  if (event === 'permission' && typeof open !== 'boolean') throw new Error('permission open')
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('chat event time')
  return { event: event as EventName, data: record, open: typeof open === 'boolean' ? open : undefined, at }
}
