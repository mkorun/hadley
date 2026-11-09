// The chat with an agent, beside the editor (docs/dev-server.md, "Chat"): loaded by main.ts only where the page has
// the chat on (lib/dev-server.ts marks it), after the editor's bar stands. It makes the chat's state (chat.ts), the
// panel (panel.ts), the thread (thread.ts) and the rewrite in the field (rewrite.ts), sends what the author writes,
// and listens to the dev server's event stream: a fresh history first, then each event, again after each reconnect.
import { DIRECTIONS, element, post, type Chat, type Ui } from './chat.ts'
import { checkEntry } from './events.ts'
import { buildPanel } from './panel.ts'
import { buildRewrite } from './rewrite.ts'
import { TEXT } from './texts.ts'
import { buildThread } from './thread.ts'

// The site's key to the chat's routes (addons/chat/browser-key.ts), which the link hadley dev printed left in this
// origin's storage (addons/chat/plugin.ts, its unlock page): scheme, host and port bound it, unlike a cookie, which
// every port of localhost would get.
const KEY_STORE = 'hadley-chat-key'

const unset = () => {
  throw new Error('chat: a part not installed yet')
}

function start(): void {
  // the editor's language (core/texts.ts): the browser's, or the one chosen in its control
  const lang = document.documentElement.dataset['hadleyLang'] === 'de' ? 'de' : 'en'
  const t = TEXT[lang]
  let key: string | null = null
  try {
    key = localStorage.getItem(KEY_STORE)
  } catch {
    // without storage the browser holds no key, and the panel says how to get one
  }
  const chat: Chat = {
    lang,
    t,
    say: (name) => t[name].replaceAll('{agent}', chat.agentName),
    key,
    ui: undefined as unknown as Ui,
    opened: false,
    size: 'compact',
    unseen: false,
    connected: false,
    background: null,
    available: [],
    sending: false,
    sequence: 0,
    replaying: false,
    rewritesSending: 0,
    detailsShown: false,
    direction: DIRECTIONS[0],
    instruction: '',
    // the name the connected session gives itself (through the dev server); the texts carry it
    agentName: t.agent,
    editor: null,
    rewriteRow: null,
    messages: new Map(),
    replies: new Map(),
    suggestions: new Map(),
    deliveries: new Map(),
    localActions: new Map(),
    permissions: [],
    answers: new Map(),
    setOpen: unset,
    setSize: unset,
    updateSend: unset,
    updateDot: unset,
    setConnected: unset,
    setAgent: unset,
    setAvailable: unset,
    save: unset,
    receive: unset,
    addMessage: unset,
    record: unset,
    updateState: unset,
    complete: unset,
    finish: unset,
    applySuggestion: unset,
    setStatus: unset,
    setStatusLabel: unset,
  }
  chat.ui = buildPanel(chat)
  buildThread(chat)
  buildRewrite(chat)
  const { ui } = chat

  // the requests' waiting times, each second
  const counter = setInterval(() => {
    for (const request of chat.messages.values()) chat.updateState(request)
  }, 1000)

  async function submit(): Promise<void> {
    if (ui.send.disabled) return
    const started = Date.now()
    const text = ui.input.value
    chat.sending = true
    ui.error.textContent = ''
    // Reserve its place before a fast channel can send a reply or a permission over SSE.
    const pending = element('article', undefined, 'hc-thread')
    pending.append(element('p', t.you, 'hc-byline'), element('p', text, 'hc-message'), element('p', t.sending))
    ui.list.append(pending)
    chat.updateSend()
    try {
      const response = await post(chat, '/__hadley/chat', { text, page: location.pathname })
      if (!response.ok) {
        if (response.status === 503) {
          chat.setConnected(false)
          ui.error.textContent = t.noAgent
        } else if (response.status === 409 || response.status === 404) ui.error.textContent = t.reload
        else ui.error.textContent = response.status === 400 ? t.invalid : t.failed
        return
      }
      const data = (await response.json()) as { id?: unknown } | null
      if (!data || typeof data.id !== 'string') throw new Error('message id')
      chat.addMessage({ id: data.id, text }, pending, started)
      if (ui.input.value === text) ui.input.value = ''
      chat.save()
    } catch {
      ui.error.textContent = t.failed
    } finally {
      pending.remove()
      chat.sending = false
      chat.updateSend()
    }
  }
  ui.input.form?.addEventListener('submit', (event) => {
    event.preventDefault()
    void submit()
  })
  ui.input.addEventListener('input', () => {
    chat.save()
    chat.updateSend()
  })
  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void submit()
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && chat.opened) {
      event.preventDefault()
      chat.setOpen(false)
    }
  })
  // one card above the pill at a time: the chat's or the versions' (features/versions/)
  document.addEventListener('hadley:card-open', (event) => {
    if (chat.opened && (event as CustomEvent<{ id?: string }>).detail?.id !== ui.panel.id) chat.setOpen(false, false)
  })

  chat.setAgent(undefined)
  chat.setSize(chat.size)
  chat.setOpen(chat.opened, chat.opened)
  chat.updateSend()

  // the chat's routes answer the browser that holds the site's key (browser-key.ts): without it, the panel says how
  let stream: EventSource | undefined
  function listen(): void {
    // an event stream sends no header of its own: the key goes in its address, which only this server sees
    stream = new EventSource(`/__hadley/chat/events?lang=${lang}&key=${encodeURIComponent(chat.key ?? '')}`)
    stream.addEventListener('history', (event) => {
      try {
        const entries: unknown = JSON.parse((event as MessageEvent<string>).data)
        if (!Array.isArray(entries)) throw new Error('history')
        const checked = (entries as Record<string, unknown>[]).map((entry) =>
          checkEntry(String(entry['event']), entry['data'], entry['open'], entry['at'] as number),
        )
        ui.list.setAttribute('aria-busy', 'true')
        ui.list.replaceChildren()
        chat.messages.clear()
        chat.replies.clear()
        chat.suggestions.clear()
        chat.deliveries.clear()
        chat.permissions.length = 0
        // Historical statuses precede permissions that may still be open: only the following live status is current.
        chat.replaying = true
        for (const entry of checked) if (entry.event !== 'status') chat.receive(entry)
      } catch {
        ui.error.textContent = t.streamFailed
      } finally {
        chat.replaying = false
        ui.list.removeAttribute('aria-busy')
      }
    })
    for (const name of ['reply', 'suggestion', 'delivered', 'permission', 'status', 'notice']) {
      stream.addEventListener(name, (event) => {
        const message = event as MessageEvent<string>
        try {
          chat.receive(
            checkEntry(
              name,
              JSON.parse(message.data),
              name === 'permission' ? true : undefined,
              message.lastEventId ? Number(message.lastEventId) : Date.now(),
            ),
          )
        } catch {
          ui.error.textContent = t.streamFailed
        }
      })
    }
    // EventSource retries itself and receives a fresh authoritative history, including after a dev server restart.
    stream.addEventListener('error', () => {
      chat.setConnected(false)
      ui.status.textContent = t.reconnecting
    })
  }
  function lock(): void {
    chat.setConnected(false)
    ui.offline.hidden = true
    ui.status.textContent = t.locked
    ui.error.textContent = t.locked
    ui.dot.dataset['state'] = 'offline'
  }
  fetch('/__hadley/chat/key', { cache: 'no-store', headers: chat.key ? { 'X-Hadley-Key': chat.key } : {} })
    .then((response) => {
      if (response.status !== 401) return listen()
      // a key that is no longer the site's is forgotten
      try {
        localStorage.removeItem(KEY_STORE)
      } catch {
        // nothing kept
      }
      lock()
    })
    .catch(() => listen())
  window.addEventListener('pagehide', () => {
    stream?.close()
    clearInterval(counter)
  })
}

start()
