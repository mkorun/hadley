// The rewrite of the open field (features/field.ts hands it over by `hadley:editor-open`): in its drawer
// (features/drawers.ts), a way, an instruction, the button that asks the agent, what it rewrites, its status and Take
// back. The proposal takes the place of the block's text or its selection in the field; only saving writes it.
import { icon } from '../../core/icons.ts'
import { selectionOf } from './reply.ts'
import { button, DIRECTIONS, element, post, type Chat, type Direction, type Row, type Target } from './chat.ts'

// the spinner of Claude Code, its glyphs in turn; with reduced motion one stays
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽']

/** What the rewrite does, installed on `chat`, and the row it puts in each field that opens. */
export function buildRewrite(chat: Chat): void {
  const { t } = chat
  const still = matchMedia('(prefers-reduced-motion: reduce)')

  /** The row's status: what a rewrite is doing, its label for a screen reader, and the time it has taken. */
  chat.setStatus = (row, kind, label) => {
    clearInterval(row.timer)
    const { state } = row
    state.dataset['state'] = kind
    state.title = kind === 'done' || kind === 'error' ? label : ''
    const text = element('span', label, 'hc-status-label')
    if (kind === 'pending') {
      const glyph = element('span', SPINNER[0], 'hc-spinner')
      const time = element('span', '0.0 s', 'hc-status-time')
      glyph.setAttribute('aria-hidden', 'true')
      time.setAttribute('aria-hidden', 'true')
      let frame = 0
      const tick = () => {
        glyph.textContent = still.matches ? '✻' : SPINNER[frame++ % SPINNER.length]!
        time.textContent = `${((Date.now() - row.started) / 1000).toFixed(1)} s`
      }
      tick()
      row.timer = setInterval(tick, 120)
      state.replaceChildren(glyph, time, text)
    } else if (kind === 'permission') {
      state.replaceChildren(
        button(t.permissionNeeded, () => chat.setOpen(true)),
        text,
      )
    } else {
      const mark = element('span', undefined, 'hc-status-icon')
      mark.append(icon(kind === 'done' ? 'check' : 'cross'))
      state.replaceChildren(mark, text)
    }
    if (kind !== 'done') row.undo.hidden = true
  }
  /** A label for the screen reader, while the row keeps its kind and its time. */
  chat.setStatusLabel = (row, label) => {
    const text = row.state.querySelector('.hc-status-label')
    if (text) text.textContent = label
  }

  async function rewrite(target: Target, row: Row, chosen: Direction): Promise<void> {
    if (!chat.connected || row.pending || chat.editor !== target) return
    const selection = selectionOf(target.textarea)
    const own = row.custom.value.trim()
    if ((chosen === 'custom' && !own) || own.length > 500) {
      chat.setStatus(row, 'error', t.instructionInvalid)
      return
    }
    chat.direction = chosen
    chat.instruction = row.custom.value
    chat.save()
    const started = Date.now()
    const draft = target.textarea.value
    row.pending = true
    row.started = started
    row.earlyPermissions = []
    chat.rewritesSending++
    chat.setStatus(row, 'pending', t.sent)
    chat.updateSend()
    try {
      const data = {
        page: location.pathname,
        block: target.block,
        draft,
        action: selection ? 'rewrite-selection' : 'rewrite-block',
        direction: chosen,
        ...(own ? { instruction: own } : {}),
        ...(selection ? { selection } : {}),
      }
      const response = await post(chat, '/__hadley/chat', data)
      if (!response.ok) {
        chat.setStatus(
          row,
          'error',
          response.status === 409 || response.status === 404
            ? t.reload
            : response.status === 503
              ? t.noAgent
              : t.invalid,
        )
        row.pending = false
        return
      }
      const result = (await response.json()) as { id?: unknown }
      if (typeof result.id !== 'string') throw new Error('message id')
      const id = result.id
      chat.addMessage({ ...data, id, text: `${t.rewrite} · ${t[chosen]}` }, undefined, started)
      const request = chat.messages.get(id)!
      chat.localActions.set(id, { target, row, draft, selection, request })
      for (const event of row.earlyPermissions) chat.record(id, 'permission', event.data, t.permission, event.at)
      request.permission = chat.permissions.some((card) => card.open)
      chat.updateState(request)
      if (request.completed) row.pending = false
      for (const [key, card] of chat.suggestions)
        if (card.data['to'] === id) {
          chat.complete(id, 'suggestion', card.data, t.proposal, card.at)
          chat.applySuggestion(key)
        }
    } catch {
      row.pending = false
      chat.setStatus(row, 'error', t.failed)
    } finally {
      chat.rewritesSending--
      chat.updateSend()
    }
  }

  document.addEventListener('hadley:editor-close', () => {
    clearInterval(chat.rewriteRow?.timer)
    chat.editor = null
    chat.rewriteRow = null
  })
  document.addEventListener('hadley:editor-open', (event) => {
    const target = (event as CustomEvent<Target>).detail
    chat.editor = target
    if (target.frontMatter) return
    // the rewrite stands in a drawer of the field: a way, an instruction, the send button, what it rewrites, its status
    // and Take back
    const node = element('div', undefined, 'hadley-rewrite')
    const select = element('select', undefined, 'hc-direction')
    select.setAttribute('aria-label', t.direction)
    for (const value of DIRECTIONS) {
      const option = element('option', t[value])
      option.value = value
      select.append(option)
    }
    select.value = chat.direction
    const custom = element('input', undefined, 'hc-instruction')
    custom.type = 'text'
    custom.maxLength = 500
    custom.value = chat.instruction
    custom.setAttribute('aria-label', chat.say('instruction'))
    const placeholder = () => {
      custom.placeholder = select.value === 'custom' ? chat.say('instruction') : t.instructionOptional
    }
    placeholder()
    // without an agent, the button opens the chat, where one starts
    const ask = () => {
      // asked by its keys with the drawer folded: it opens, so that the request and its answer show
      target.openDrawer?.('rewrite')
      if (chat.connected) void rewrite(target, row, select.value as Direction)
      else chat.setOpen(true)
    }
    const send = button('', ask)
    send.className = 'hc-send'
    // the star and the word, where the row has room; the star alone where it has not (chat.css)
    send.append(icon('sparkle'), element('span', t.rewrite, 'hc-send-label'))
    // the editing field keeps the focus, and with it the selection the browser paints
    send.addEventListener('mousedown', (e) => e.preventDefault())
    const scope = element('span', undefined, 'hc-rewrite-scope')
    const state = element('span', undefined, 'hc-rewrite-state')
    state.setAttribute('role', 'status')
    const undo = button('', () => {
      target.textarea.focus()
      document.execCommand('undo')
      undo.hidden = true
    })
    // a word, not the ring of the pill's undo, which takes back a change of the page (Michael, 2026-11-09)
    undo.className = 'hc-undo'
    undo.textContent = t.undo
    undo.title = `${t.undoTitle} (${t.undoShortcut})`
    undo.hidden = true
    const row: Row = {
      node,
      state,
      select,
      custom,
      undo,
      placeholder,
      showScope: () => {},
      pending: false,
      controls: [select, custom, send],
      started: 0,
      earlyPermissions: [],
    }
    select.addEventListener('change', () => {
      chat.direction = select.value as Direction
      placeholder()
      chat.save()
      // back to the field, whose selection shows again
      target.textarea.focus()
    })
    custom.addEventListener('input', () => {
      chat.instruction = custom.value
      chat.save()
    })
    // in the instruction Enter asks; in the block's field Ctrl+Shift+Enter, as Ctrl+Enter saves the block (Michael,
    // 2026-11-09)
    const sendOnEnter = (key: KeyboardEvent, plain: boolean) => {
      const chord = (key.ctrlKey || key.metaKey) && key.shiftKey
      if (key.key !== 'Enter' || key.isComposing || (!plain && !chord)) return
      key.preventDefault()
      ask()
    }
    custom.addEventListener('keydown', (key) => sendOnEnter(key, true))
    target.textarea.addEventListener('keydown', (key) => sendOnEnter(key, false))
    // what the next action rewrites: the button names it; a selection also shows, with its length, as the whole block
    // is what it rewrites otherwise
    const showScope = () => {
      if (!chat.connected) {
        // the name starts with the word the button shows, for voice control
        send.setAttribute('aria-label', `${t.rewrite}: ${t.noAgentRewrite}`)
        send.title = t.noAgentRewrite
        scope.hidden = true
        return
      }
      const selection = selectionOf(target.textarea)
      const label = selection ? t.rewriteSelection : t.rewriteBlock
      send.setAttribute('aria-label', label)
      send.title = `${label} (${t.rewriteShortcut})`
      const length = selection ? [...target.textarea.value.slice(selection.start, selection.end)].length : 0
      scope.hidden = !selection
      scope.textContent = length === 1 ? t.scopeSelectionOne : t.scopeSelection.replace('{n}', String(length))
    }
    for (const type of ['select', 'keyup', 'mouseup', 'input', 'focus'])
      target.textarea.addEventListener(type, showScope)
    row.showScope = showScope
    showScope()
    node.append(select, custom, send, scope, state, undo)
    // in the field's drawer, folded under its toolbar until opened (features/drawers.ts; Michael, 2026-11-09); an
    // editor without drawers takes it in its toolbar
    const symbol = element('span', undefined, 'hc-drawer-symbol')
    symbol.append(icon('sparkle'))
    const drawer = target.drawer?.('rewrite', t.rewrite, symbol)
    ;(drawer ?? target.wrapper.querySelector('.hadley-editor-toolbar') ?? target.wrapper).append(node)
    chat.rewriteRow = row
    chat.updateSend()
  })
}
