// The chat's panel and its half of the editor's control (features/bar.ts): a bubble with a dot that tells its state,
// the panel, compact as a card above the control or large beside the page, the agent the dev server runs itself
// (addons/chat/agents.ts) started, restarted or stopped, and the panel's state kept for the tab.
import { icon } from '../../core/icons.ts'
import { AGENT_TITLES, type AgentName } from './events.ts'
import { button, DIRECTIONS, element, post, type Chat, type Direction, type Ui } from './chat.ts'

const STORAGE_KEY = 'hadley-chat'

/** The panel's parts, in the editor's bar; what the panel does, installed on `chat`. */
export function buildPanel(chat: Chat): Ui {
  const { t } = chat
  // the chat's half of the editor's control (features/bar.ts): a bubble and a dot that tells its state
  const toggle = button('', () => chat.setOpen(!chat.opened))
  toggle.id = 'hadley-chat-toggle'
  toggle.setAttribute('aria-controls', 'hadley-chat')
  toggle.setAttribute('aria-label', t.toggle)
  toggle.append(icon('chat'))
  const dot = element('span', undefined, 'hc-dot')
  toggle.append(dot)
  const panel = element('section')
  // hidden from the start, setOpen() shows it if it was open: it flashed up on each load (Michael, 2026-11-09)
  panel.hidden = true
  panel.id = 'hadley-chat'
  panel.setAttribute('aria-labelledby', 'hadley-chat-title')
  const header = element('header')
  const title = element('h2')
  title.id = 'hadley-chat-title'
  const resize = button('', () => chat.setSize(chat.size === 'compact' ? 'large' : 'compact'))
  resize.className = 'hc-resize'
  const close = button('', () => chat.setOpen(false))
  close.className = 'hc-close'
  close.setAttribute('aria-label', t.close)
  close.title = t.close
  close.append(icon('cross'))
  // the agent the dev server runs itself: a new conversation, or stop it (addons/chat/agents.ts)
  const freshButton = button(t.fresh, () => void runAgent(chat.background, true))
  freshButton.className = 'hc-agent-control'
  const stopButton = button(t.stop, () => void runAgent(null))
  stopButton.className = 'hc-agent-control'
  header.append(title, resize, close)
  // under the header, so that the card keeps its title on one line
  const agentBar = element('div', undefined, 'hc-agent-bar')
  agentBar.append(freshButton, stopButton)
  agentBar.hidden = true
  const detailsSwitch = element('input')
  detailsSwitch.type = 'checkbox'
  const detailsLabel = element('label', t.details, 'hc-details-switch')
  detailsLabel.prepend(detailsSwitch)
  detailsSwitch.addEventListener('change', () => {
    chat.detailsShown = detailsSwitch.checked
    for (const request of chat.messages.values()) request.timeline.hidden = !chat.detailsShown
    chat.save()
  })
  const status = element('p', t.reconnecting, 'hc-status')
  status.setAttribute('role', 'status')
  // without an agent: a button for each the dev server can start, or where none was found, that
  const offline = element('div', undefined, 'hc-offline')
  const offlineText = element('p', t.noAgent)
  const starters = element('div', undefined, 'hc-starters')
  const startResult = element('p')
  startResult.setAttribute('role', 'status')
  offline.append(offlineText, starters, startResult)
  const list = element('div', undefined, 'hc-messages')
  list.setAttribute('aria-live', 'polite')
  list.setAttribute('aria-relevant', 'additions text')
  const form = element('form')
  const label = element('label')
  label.htmlFor = 'hadley-chat-input'
  const input = element('textarea')
  input.id = 'hadley-chat-input'
  // the compact card hides the label; the field keeps its name and says it in place
  input.rows = 3
  const hint = element('p', t.hint, 'hc-hint')
  hint.id = 'hadley-chat-hint'
  input.setAttribute('aria-describedby', hint.id)
  const error = element('p', undefined, 'hc-error')
  error.setAttribute('role', 'alert')
  const send = element('button', t.send)
  send.type = 'submit'
  form.append(label, input, hint, error, send)
  panel.append(header, agentBar, detailsLabel, status, offline, list, form)
  // Sharing the editor's bar keeps all its fixed controls clear of the chat button.
  const devBar = document.querySelector('#hadley-dev-bar')!
  ;(devBar.querySelector('.hadley-pill') ?? devBar).append(toggle)
  devBar.prepend(panel)

  const ui: Ui = {
    toggle,
    dot,
    panel,
    title,
    resize,
    freshButton,
    stopButton,
    agentBar,
    detailsSwitch,
    status,
    offline,
    offlineText,
    starters,
    startResult,
    list,
    label,
    input,
    error,
    send,
  }

  /** Starts an agent in the background, a new conversation if fresh, or stops it (null). */
  async function runAgent(name: AgentName | null, fresh = false): Promise<void> {
    startResult.textContent = name ? t.starting.replace('{agent}', AGENT_TITLES[name]) : ''
    const controls = [...starters.children, freshButton, stopButton] as HTMLButtonElement[]
    for (const control of controls) control.disabled = true
    try {
      const response = await post(chat, '/__hadley/chat/agent', { run: name, fresh })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { channel?: unknown }
        startResult.textContent = body.channel ? t.channelBusy : t.failed
      } else startResult.textContent = ''
    } catch {
      startResult.textContent = t.failed
    } finally {
      for (const control of controls) control.disabled = false
    }
  }

  // closing plays its short animation first (chat.css); opening again stops it
  let closing: ReturnType<typeof setTimeout> | undefined
  chat.setSize = (value) => {
    chat.size = value
    panel.dataset['size'] = value
    const said = value === 'compact' ? t.larger : t.smaller
    resize.setAttribute('aria-label', said)
    resize.title = said
    resize.replaceChildren(icon(value === 'compact' ? 'expand' : 'shrink'))
    chat.save()
  }

  chat.setAvailable = (names) => {
    chat.available = names
    starters.replaceChildren(
      ...names.map((name) => button(t.start.replace('{agent}', AGENT_TITLES[name]), () => void runAgent(name))),
    )
    offlineText.textContent = names.length ? t.noAgent : t.noProgram
    // the large panel says it in its status line already (chat.css)
    offlineText.className = names.length ? 'hc-no-agent' : ''
  }
  chat.save = () => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          opened: chat.opened,
          size: chat.size,
          draft: input.value,
          detailsShown: chat.detailsShown,
          direction: chat.direction,
          instruction: chat.instruction,
        }),
      )
    } catch {
      // Storage can be disabled or full; the current page still works.
    }
  }
  chat.setOpen = (value, focus = true) => {
    chat.opened = value
    clearTimeout(closing)
    panel.classList.remove('hc-closing')
    if (value || panel.hidden) panel.hidden = !value
    else {
      panel.classList.add('hc-closing')
      closing = setTimeout(() => {
        panel.classList.remove('hc-closing')
        panel.hidden = true
      }, 140)
    }
    toggle.setAttribute('aria-expanded', String(value))
    // one card above the pill at a time: the chat's or the versions' (features/versions/)
    if (value) document.dispatchEvent(new CustomEvent('hadley:card-open', { detail: { id: panel.id } }))
    if (value) chat.unseen = false
    chat.updateDot()
    chat.save()
    if (focus) (value ? input : toggle).focus()
  }
  /** The dot on the control: a permission to give, a reply not seen yet, connected, or none (no dot). */
  chat.updateDot = () => {
    const state = chat.permissions.some((card) => card.open)
      ? 'permission'
      : chat.unseen
        ? 'new'
        : chat.connected
          ? 'connected'
          : 'offline'
    dot.dataset['state'] = state
    const said = {
      permission: t.waitingPermission,
      new: t.newReply,
      connected: chat.say('connected'),
      offline: t.noAgent,
    }
    toggle.title = `${t.toggle} · ${said[state]}`
  }
  chat.updateSend = () => {
    send.disabled = !chat.connected || chat.sending || !input.value.trim()
    send.textContent = chat.sending ? t.sending : t.send
    const row = chat.rewriteRow
    if (row) {
      for (const control of row.controls) control.disabled = row.pending
      // without an agent only the button stays, and it opens the chat to start one (Michael, 2026-11-09)
      row.select.hidden = row.custom.hidden = !chat.connected
      row.showScope()
    }
    for (const card of chat.permissions) {
      for (const control of card.controls) control.disabled = !chat.connected || card.pending
    }
  }
  /** Names the agent wherever the panel and the rewrite row say it. */
  chat.setAgent = (name) => {
    chat.agentName = name ?? t.agent
    title.textContent = chat.say('title')
    label.textContent = chat.say('input')
    input.setAttribute('aria-label', chat.say('input'))
    input.placeholder = chat.say('input')
    if (chat.rewriteRow) {
      chat.rewriteRow.custom.setAttribute('aria-label', chat.say('instruction'))
      chat.rewriteRow.placeholder()
    }
    if (chat.connected) status.textContent = chat.say('connected')
    chat.updateDot()
  }
  chat.setConnected = (value) => {
    chat.connected = value
    status.textContent = value ? chat.say('connected') : t.noAgent
    offline.hidden = value
    agentBar.hidden = !value || !chat.background
    if (chat.background) {
      freshButton.title = chat.say('freshTitle')
      stopButton.title = chat.say('stopTitle')
    }
    chat.updateSend()
    chat.updateDot()
  }

  // the panel as the tab left it: open or not, its size, the draft, the details, the way and the instruction
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (saved && typeof saved['opened'] === 'boolean' && typeof saved['draft'] === 'string') {
      if (typeof saved['detailsShown'] === 'boolean') chat.detailsShown = saved['detailsShown']
      const direction = saved['direction']
      if (DIRECTIONS.includes(direction as Direction)) chat.direction = direction as Direction
      const instruction = saved['instruction']
      if (typeof instruction === 'string' && instruction.length <= 500) chat.instruction = instruction
      chat.opened = saved['opened']
      if (saved['size'] === 'large') chat.size = 'large'
      input.value = saved['draft']
    }
  } catch {
    // An unreadable saved draft must not disable the current panel.
  }
  detailsSwitch.checked = chat.detailsShown
  return ui
}
