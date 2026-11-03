/**
 * Browser panel, loaded after editor.js only in chat-enabled dev pages. Client texts live here, like editor.js.
 * The one editor event is documented in docs/dev-server.md, Chat. Imports in unit tests start no browser work.
 */
export const TEXT = {
  en: {
    title: 'Chat with Claude',
    toggle: 'Chat',
    close: 'Close chat',
    connected: 'Claude Code connected',
    offline: 'No session connected',
    disconnected: 'No Claude Code session connected. Start one in the directory with your .mcp.json:',
    reconnecting: 'Reconnecting to the dev server…',
    copy: 'Copy start command',
    copied: 'Command copied',
    copyFailed: 'Could not copy. Select and copy the command above.',
    input: 'Message to Claude',
    send: 'Send',
    sending: 'Sending…',
    hint: 'Enter sends · Shift+Enter adds a line',
    remove: 'Remove attached block',
    reattach: 'This block changed or cannot be identified after the reload. Attach it again or remove it.',
    you: 'You',
    claude: 'Claude',
    permission: 'Tool permission',
    newest: 'Newest open request',
    preview: 'Show preview',
    allow: 'Allow',
    deny: 'Deny',
    allowed: 'Answered: Allow',
    denied: 'Answered: Deny',
    answered: 'Answered',
    elsewhere: 'Answered elsewhere',
    reload: 'The block source changed or is no longer available. Reload the page first.',
    invalid: 'The server rejected this message. Check the text and try again.',
    failed: 'The request failed. Please try again.',
    streamFailed: 'The dev server sent an invalid chat event. Reload the page.',
  },
  de: {
    title: 'Chat mit Claude',
    toggle: 'Chat',
    close: 'Chat schließen',
    connected: 'Claude Code verbunden',
    offline: 'Keine Sitzung verbunden',
    disconnected: 'Keine Claude-Code-Sitzung verbunden. Starte eine im Verzeichnis mit deiner .mcp.json:',
    reconnecting: 'Verbindung zum Entwicklungsserver wird wiederhergestellt…',
    copy: 'Startbefehl kopieren',
    copied: 'Befehl kopiert',
    copyFailed: 'Kopieren fehlgeschlagen. Bitte den Befehl oben auswählen und kopieren.',
    input: 'Nachricht an Claude',
    send: 'Senden',
    sending: 'Wird gesendet…',
    hint: 'Enter sendet · Umschalt+Enter fügt eine Zeile ein',
    remove: 'Angehängten Block entfernen',
    reattach:
      'Dieser Block wurde geändert oder ist nach dem Neuladen nicht eindeutig. Bitte erneut anhängen oder entfernen.',
    you: 'Du',
    claude: 'Claude',
    permission: 'Werkzeugfreigabe',
    newest: 'Neueste offene Anfrage',
    preview: 'Vorschau anzeigen',
    allow: 'Erlauben',
    deny: 'Ablehnen',
    allowed: 'Beantwortet: Erlauben',
    denied: 'Beantwortet: Ablehnen',
    answered: 'Beantwortet',
    elsewhere: 'Anderweitig beantwortet',
    reload: 'Die Blockquelle wurde geändert oder ist nicht mehr verfügbar. Bitte zuerst die Seite neu laden.',
    invalid: 'Der Server hat die Nachricht abgelehnt. Bitte den Text prüfen und erneut versuchen.',
    failed: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.',
    streamFailed: 'Der Entwicklungsserver hat ein ungültiges Chat-Ereignis gesendet. Bitte die Seite neu laden.',
  },
}

export const START_COMMAND = 'claude --dangerously-load-development-channels server:hadley'

/** A deliberately small reply grammar. HTML and unsupported links remain literal text. */
export function inlineParts(source) {
  const parts = []
  const tokens = /`([^`\n]+)`|\[([^\[\]\n]+)\]\(([^()\[\]\s]+)\)/g
  let start = 0
  for (const match of source.matchAll(tokens)) {
    if (match.index > start) parts.push({ text: source.slice(start, match.index) })
    if (match[1] !== undefined) parts.push({ code: match[1] })
    else {
      let href
      try {
        const url = new URL(match[3])
        if (url.protocol === 'http:' || url.protocol === 'https:') href = url.href
      } catch {
        // A malformed or relative destination stays visible as text.
      }
      parts.push(href ? { text: match[2], href } : { text: match[0] })
    }
    start = match.index + match[0].length
  }
  if (start < source.length) parts.push({ text: source.slice(start) })
  return parts
}

export function replyParts(source) {
  const blocks = []
  let lines = []
  let fenced = false
  const flush = () => {
    if (lines.length) blocks.push({ code: fenced, text: lines.join('\n') })
    lines = []
  }
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if ((!fenced && /^```[^`]*$/.test(line)) || (fenced && /^```\s*$/.test(line))) {
      flush()
      fenced = !fenced
    } else if (!fenced && !line.trim()) flush()
    else lines.push(line)
  }
  flush()
  return blocks
}

/** Reply strings only reach textContent; only inlineParts' checked absolute HTTP(S) URL can reach href. */
export function renderReply(parent, source) {
  const doc = parent.ownerDocument
  for (const block of replyParts(source)) {
    const node = doc.createElement(block.code ? 'pre' : 'p')
    if (block.code) {
      const code = doc.createElement('code')
      code.textContent = block.text
      node.append(code)
    } else {
      for (const part of inlineParts(block.text)) {
        const span = doc.createElement(part.href ? 'a' : part.code !== undefined ? 'code' : 'span')
        span.textContent = part.code ?? part.text
        if (part.href) {
          span.href = part.href
          span.target = '_blank'
          span.rel = 'noopener noreferrer'
        }
        node.append(span)
      }
    }
    parent.append(node)
  }
}

/** IDs are per-build: retain an existing ID, or require one exact text match on the original page. */
export function restoreBlock(attachment, page, blocks) {
  if (attachment.page !== page) return undefined
  if (blocks.some((block) => block.id === attachment.block)) return attachment.block
  const matches = blocks.filter((block) => block.text === attachment.text)
  return matches.length === 1 ? matches[0].id : undefined
}

/** Check SSE JSON once at the boundary; never infer a missing event field. */
function checkEntry(event, data, open) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('chat event')
  const fields = {
    message: ['id', 'text'],
    reply: ['id', 'text'],
    permission: ['request_id', 'tool', 'description', 'preview'],
    status: [],
  }[event]
  if (!fields || fields.some((key) => typeof data[key] !== 'string')) throw new Error('chat event fields')
  if (event === 'reply' && data.to !== undefined && typeof data.to !== 'string') throw new Error('reply to')
  if (event === 'status' && typeof data.connected !== 'boolean') throw new Error('status')
  if (event === 'permission' && typeof open !== 'boolean') throw new Error('permission open')
  return { event, data, open }
}

function startPanel() {
  const lang = document.documentElement.lang === 'de' ? 'de' : 'en'
  const t = TEXT[lang]
  const storageKey = 'hadley-chat'
  let opened = false
  let attachment = null
  let attachmentStale = false
  let connected = false
  let sending = false
  let sequence = 0
  const messages = new Map()
  const replies = new Map()
  const permissions = []
  const answers = new Map()

  const element = (tag, text, className) => {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    return node
  }
  const button = (text, action) => {
    const node = element('button', text)
    node.type = 'button'
    node.addEventListener('click', action)
    return node
  }
  const toggle = button(t.toggle, () => setOpen(!opened))
  toggle.id = 'hadley-chat-toggle'
  toggle.setAttribute('aria-controls', 'hadley-chat')
  const panel = element('section')
  panel.id = 'hadley-chat'
  panel.setAttribute('aria-labelledby', 'hadley-chat-title')
  const header = element('header')
  const title = element('h2', t.title)
  title.id = 'hadley-chat-title'
  header.append(
    title,
    button(t.close, () => setOpen(false)),
  )
  const status = element('p', t.reconnecting, 'hc-status')
  status.setAttribute('role', 'status')
  const offline = element('div', undefined, 'hc-offline')
  const command = element('code', START_COMMAND)
  const copyResult = element('p')
  copyResult.setAttribute('role', 'status')
  offline.append(
    element('p', t.disconnected),
    command,
    button(t.copy, () => {
      void copyCommand()
    }),
    copyResult,
  )
  const list = element('div', undefined, 'hc-messages')
  list.setAttribute('aria-live', 'polite')
  list.setAttribute('aria-relevant', 'additions text')
  const form = element('form')
  const attached = element('div', undefined, 'hc-attachment')
  const excerpt = element('span')
  attached.append(
    excerpt,
    button(t.remove, () => {
      attachment = null
      if (attachmentStale) error.textContent = ''
      attachmentStale = false
      updateSend()
      updateAttachment()
      save()
    }),
  )
  const label = element('label', t.input)
  label.htmlFor = 'hadley-chat-input'
  const input = element('textarea')
  input.id = 'hadley-chat-input'
  input.rows = 3
  const hint = element('p', t.hint, 'hc-hint')
  hint.id = 'hadley-chat-hint'
  input.setAttribute('aria-describedby', hint.id)
  const error = element('p', undefined, 'hc-error')
  error.setAttribute('role', 'alert')
  const send = element('button', t.send)
  send.type = 'submit'
  form.append(attached, label, input, hint, error, send)
  panel.append(header, status, offline, list, form)
  // Sharing the editor's bar keeps all its fixed controls clear of the chat button.
  const devBar = document.querySelector('#hadley-dev-bar')
  devBar.prepend(toggle)
  devBar.prepend(panel)

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(START_COMMAND)
      copyResult.textContent = t.copied
    } catch {
      copyResult.textContent = t.copyFailed
    }
  }
  function save() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ opened, draft: input.value, attachment }))
    } catch {
      // Storage can be disabled or full; the current page still works.
    }
  }
  function setOpen(value, focus = true) {
    opened = value
    panel.hidden = !value
    toggle.setAttribute('aria-expanded', String(value))
    save()
    if (focus) (value ? input : toggle).focus()
  }
  function updateAttachment() {
    attached.hidden = attachment === null
    excerpt.textContent = attachment?.text.slice(0, 100) ?? ''
  }
  function updateSend() {
    send.disabled = !connected || sending || attachmentStale || !input.value.trim()
    send.textContent = sending ? t.sending : t.send
    for (const card of permissions) {
      for (const control of card.controls) control.disabled = !connected || card.pending
    }
  }
  function setConnected(value) {
    connected = value
    status.textContent = value ? t.connected : t.offline
    offline.hidden = value
    updateSend()
  }
  function newest() {
    const last = permissions.findLast((card) => card.open)
    for (const card of permissions) {
      card.badge.textContent = card === last ? t.newest : ''
      card.node.classList.toggle('hc-newest', card === last)
    }
  }
  function finish(card, text) {
    card.open = false
    card.controls.forEach((control) => control.remove())
    card.controls = []
    card.result.textContent = text
    answers.set(card.id, text)
    newest()
  }
  async function post(path, body) {
    return fetch(`${path}?lang=${lang}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }
  async function verdict(card, allow) {
    if (card.pending) return
    card.pending = true
    card.result.textContent = ''
    updateSend()
    try {
      const response = await post('/__hadley/chat/verdict', { request_id: card.id, allow })
      if (response.ok) finish(card, allow ? t.allowed : t.denied)
      else if (response.status === 409) finish(card, t.elsewhere)
      else {
        card.result.textContent = response.status === 503 ? t.disconnected : t.failed
        if (response.status === 503) setConnected(false)
      }
    } catch {
      card.result.textContent = t.failed
    } finally {
      card.pending = false
      updateSend()
    }
  }
  function addPermission(data, open) {
    const node = element('article', undefined, 'hc-permission')
    const heading = element('h3', data.tool)
    heading.id = `hc-tool-${++sequence}`
    node.setAttribute('aria-labelledby', heading.id)
    const badge = element('p', undefined, 'hc-newest-label')
    const preview = element('pre')
    const code = element('code', data.preview)
    preview.append(code)
    node.append(element('p', t.permission, 'hc-byline'), heading, badge, element('p', data.description))
    if (data.preview.length > 240 || data.preview.split('\n').length > 6) {
      const details = element('details')
      details.append(element('summary', t.preview), preview)
      node.append(details)
    } else node.append(preview)
    const result = element('p')
    result.setAttribute('role', 'status')
    const card = { id: data.request_id, node, badge, result, open, pending: false, controls: [] }
    if (open) {
      card.controls = [button(t.allow, () => void verdict(card, true)), button(t.deny, () => void verdict(card, false))]
      node.append(...card.controls)
    } else result.textContent = answers.get(card.id) ?? t.answered
    node.append(result)
    permissions.push(card)
    list.append(node)
    newest()
    updateSend()
  }
  function addMessage(data, pending) {
    if (messages.has(data.id)) return
    const group = element('article', undefined, 'hc-thread')
    const text = element('p', data.text, 'hc-message')
    const children = element('div', undefined, 'hc-replies')
    group.append(element('p', t.you, 'hc-byline'), text, children)
    messages.set(data.id, { group, children })
    if (pending?.isConnected) pending.replaceWith(group)
    else list.append(group)
    for (const reply of replies.values()) if (reply.to === data.id) children.append(reply.node)
  }
  function addReply(data) {
    if (replies.has(data.id)) return
    const node = element('article', undefined, 'hc-reply')
    node.append(element('p', t.claude, 'hc-byline'))
    renderReply(node, data.text)
    replies.set(data.id, { to: data.to, node })
    const parent = messages.get(data.to)?.children ?? list
    parent.append(node)
  }
  function receive({ event, data, open }) {
    switch (event) {
      case 'message':
        addMessage(data)
        break
      case 'reply':
        addReply(data)
        break
      case 'permission':
        addPermission(data, open)
        break
      case 'status':
        setConnected(data.connected)
        if (!connected) for (const card of permissions) if (card.open) finish(card, t.answered)
        break
    }
  }

  async function submit() {
    if (send.disabled) return
    const text = input.value
    const block = attachment
    sending = true
    error.textContent = ''
    // Reserve its place before a fast channel can send a reply or a permission over SSE.
    const pending = element('article', undefined, 'hc-thread')
    pending.append(element('p', t.you, 'hc-byline'), element('p', text, 'hc-message'), element('p', t.sending))
    list.append(pending)
    updateSend()
    try {
      const response = await post('/__hadley/chat', {
        text,
        page: location.pathname,
        ...(block ? { block: block.block } : {}),
      })
      if (!response.ok) {
        if (response.status === 503) {
          setConnected(false)
          error.textContent = t.disconnected
        } else if (response.status === 409 || response.status === 404) error.textContent = t.reload
        else error.textContent = response.status === 400 ? t.invalid : t.failed
        return
      }
      const data = await response.json()
      if (!data || typeof data.id !== 'string') throw new Error('message id')
      addMessage({ id: data.id, text }, pending)
      if (input.value === text) input.value = ''
      if (attachment === block) attachment = null
      updateAttachment()
      save()
    } catch {
      error.textContent = t.failed
    } finally {
      pending.remove()
      sending = false
      updateSend()
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void submit()
  })
  input.addEventListener('input', () => {
    save()
    updateSend()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void submit()
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault()
      setOpen(false)
    }
  })
  document.addEventListener('hadley:chat', (event) => {
    const detail = event.detail
    if (!detail || typeof detail.block !== 'string' || typeof detail.text !== 'string') return
    attachment = { block: detail.block, text: detail.text, page: location.pathname }
    if (attachmentStale) error.textContent = ''
    attachmentStale = false
    updateSend()
    updateAttachment()
    setOpen(true)
  })
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    if (saved && typeof saved.opened === 'boolean' && typeof saved.draft === 'string') {
      opened = saved.opened
      input.value = saved.draft
      if (
        saved.attachment &&
        typeof saved.attachment.block === 'string' &&
        typeof saved.attachment.text === 'string' &&
        typeof saved.attachment.page === 'string'
      ) {
        attachment = { block: saved.attachment.block, text: saved.attachment.text, page: saved.attachment.page }
      }
    }
  } catch {
    // An unreadable saved draft must not disable the current panel.
  }
  if (attachment) {
    const blocks = [...document.querySelectorAll('[data-hadley-id]')].map((block) => {
      const copy = block.cloneNode(true)
      copy.querySelectorAll('.hadley-trigger').forEach((trigger) => trigger.remove())
      return { id: block.dataset.hadleyId, text: copy.textContent.replace(/\s+/g, ' ').trim() }
    })
    const restored = restoreBlock(attachment, location.pathname, blocks)
    attachmentStale = restored === undefined
    if (restored !== undefined) attachment.block = restored
    else error.textContent = t.reattach
  }
  setOpen(opened, opened)
  updateAttachment()
  updateSend()
  const stream = new EventSource(`/__hadley/chat/events?lang=${lang}`)
  stream.addEventListener('history', (event) => {
    try {
      const entries = JSON.parse(event.data)
      if (!Array.isArray(entries)) throw new Error('history')
      const checked = entries.map((entry) => checkEntry(entry.event, entry.data, entry.open))
      list.setAttribute('aria-busy', 'true')
      list.replaceChildren()
      messages.clear()
      replies.clear()
      permissions.length = 0
      // Historical statuses precede permissions that may still be open: only the following live status is current.
      for (const entry of checked) if (entry.event !== 'status') receive(entry)
    } catch {
      error.textContent = t.streamFailed
    } finally {
      list.removeAttribute('aria-busy')
    }
  })
  for (const name of ['reply', 'permission', 'status']) {
    stream.addEventListener(name, (event) => {
      try {
        receive(checkEntry(name, JSON.parse(event.data), name === 'permission' ? true : undefined))
      } catch {
        error.textContent = t.streamFailed
      }
    })
  }
  // EventSource retries itself and receives a fresh authoritative history, including after a dev server restart.
  stream.addEventListener('error', () => {
    setConnected(false)
    status.textContent = t.reconnecting
  })
  window.addEventListener('pagehide', () => stream.close())
}

if (typeof document !== 'undefined') startPanel()
