// The chat's thread: what was sent and what came back, each message with its replies and a timeline of its events, the
// agent's proposals, its notices, and the tool permissions the author answers; and what an event of the stream does
// to it (receive).
import { renderReply } from './reply.ts'
import type { Entry, Fields } from './events.ts'
import { button, element, post, type Chat, type PermissionCard } from './chat.ts'

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** What the thread does, installed on `chat`. */
export function buildThread(chat: Chat): void {
  const { t, lang, ui } = chat

  /** The newest open permission is marked; the others are not. */
  function newest(): void {
    const last = chat.permissions.findLast((card) => card.open)
    for (const card of chat.permissions) {
      card.badge.textContent = card === last ? t.newest : ''
      card.node.classList.toggle('hc-newest', card === last)
    }
  }

  chat.finish = (card, text) => {
    card.open = false
    card.controls.forEach((control) => control.remove())
    card.controls = []
    card.result.textContent = text
    chat.answers.set(card.id, text)
    chat.updateDot()
    if (!chat.permissions.some((entry) => entry.open)) {
      for (const request of chat.messages.values()) {
        request.permission = false
        chat.updateState(request)
      }
    }
    newest()
  }

  async function verdict(card: PermissionCard, allow: boolean): Promise<void> {
    if (card.pending) return
    card.pending = true
    card.result.textContent = ''
    chat.updateSend()
    try {
      const response = await post(chat, '/__hadley/chat/verdict', { request_id: card.id, allow })
      if (response.ok) chat.finish(card, allow ? t.allowed : t.denied)
      else if (response.status === 409) chat.finish(card, t.elsewhere)
      else {
        card.result.textContent = response.status === 503 ? t.noAgent : t.failed
        if (response.status === 503) chat.setConnected(false)
      }
    } catch {
      card.result.textContent = t.failed
    } finally {
      card.pending = false
      chat.updateSend()
    }
  }

  function addPermission(data: Fields, open: boolean): void {
    const node = element('article', undefined, 'hc-permission')
    const heading = element('h3', str(data['tool']))
    heading.id = `hc-tool-${++chat.sequence}`
    node.setAttribute('aria-labelledby', heading.id)
    const badge = element('p', undefined, 'hc-newest-label')
    const preview = element('pre')
    const shown = str(data['preview'])
    preview.append(element('code', shown))
    node.append(element('p', t.permission, 'hc-byline'), heading, badge, element('p', str(data['description'])))
    if (shown.length > 240 || shown.split('\n').length > 6) {
      const details = element('details')
      details.append(element('summary', t.preview), preview)
      node.append(details)
    } else node.append(preview)
    const result = element('p')
    result.setAttribute('role', 'status')
    const card: PermissionCard = {
      id: str(data['request_id']),
      node,
      badge,
      result,
      open,
      pending: false,
      controls: [],
    }
    if (open) {
      card.controls = [button(t.allow, () => void verdict(card, true)), button(t.deny, () => void verdict(card, false))]
      node.append(...card.controls)
    } else result.textContent = chat.answers.get(card.id) ?? t.answered
    node.append(result)
    chat.permissions.push(card)
    chat.updateDot()
    ui.list.append(node)
    newest()
    chat.updateSend()
  }

  chat.addMessage = (data, pending, at = Date.now()) => {
    const id = str(data['id'])
    if (chat.messages.has(id)) return
    const group = element('article', undefined, 'hc-thread')
    const direction = str(data['direction']) as keyof typeof t
    const text = element('p', data['action'] ? `${t.rewrite} · ${t[direction]}` : str(data['text']), 'hc-message')
    const children = element('div', undefined, 'hc-replies')
    group.append(element('p', t.you, 'hc-byline'), text, children)
    const state = element('p', t.sent, 'hc-request-state')
    const timeline = element('ol', undefined, 'hc-timeline')
    timeline.hidden = !chat.detailsShown
    group.append(state, timeline)
    chat.messages.set(id, {
      group,
      children,
      state,
      timeline,
      started: at,
      completed: false,
      delivered: false,
      permission: false,
    })
    chat.record(id, 'message', data, t.sent, at)
    const delivery = chat.deliveries.get(id)
    if (delivery) chat.receive({ event: 'delivered', data: delivery.data, open: undefined, at: delivery.at })
    if (pending?.isConnected) pending.replaceWith(group)
    else ui.list.append(group)
    for (const reply of chat.replies.values())
      if (reply.to === id) {
        children.append(reply.node)
        chat.complete(id, 'reply', reply.data, t.answer, reply.at)
      }
  }

  function addReply(data: Fields, at = Date.now()): void {
    const id = str(data['id'])
    if (chat.replies.has(id)) return
    const to = typeof data['to'] === 'string' ? data['to'] : undefined
    if (to) chat.complete(to, 'reply', data, t.answer, at)
    const node = element('article', undefined, 'hc-reply')
    node.append(element('p', chat.say('claude'), 'hc-byline'))
    renderReply<HTMLElement>(node, str(data['text']))
    chat.replies.set(id, { to, node, data, at })
    const parent = (to && chat.messages.get(to)?.children) || ui.list
    parent.append(node)
    if (!chat.opened) {
      chat.unseen = true
      chat.updateDot()
    }
  }

  /** A line of the agent the dev server runs: continued, begun, stopped, ended, or a request it denied itself. */
  function addNotice(data: Fields, at = Date.now()): void {
    const kind = str(data['kind']) as keyof typeof t
    const text = t[kind].replaceAll('{agent}', str(data['agent'])).replace('{code}', str(data['code']))
    const node = element('p', text, 'hc-notice')
    node.title = new Date(at).toLocaleTimeString(lang)
    ui.list.append(node)
  }

  chat.record = (id, event, data, label, at = Date.now()) => {
    const request = chat.messages.get(id)
    if (!request) return
    const item = element('li')
    const raw = element('details')
    raw.append(element('summary', t.raw), element('pre', JSON.stringify({ event, data }, null, 2)))
    item.append(element('span', `${new Date(at).toLocaleTimeString(lang)} · ${label}`), raw)
    item.dataset['at'] = String(at)
    const following = [...request.timeline.children].find((entry) => Number((entry as HTMLElement).dataset['at']) > at)
    request.timeline.insertBefore(item, following ?? null)
  }

  chat.updateState = (request) => {
    if (request.completed) return
    const seconds = Math.floor((Date.now() - request.started) / 1000)
    // a message for the agent the dev server runs waits in its line until the one before is answered
    request.state.textContent = request.permission
      ? t.waitingPermission
      : chat.background && !request.delivered
        ? chat.say('queued')
        : seconds > 0
          ? t.waiting.replace('{n}', String(seconds))
          : request.delivered
            ? t.delivered
            : t.sent
    const local = [...chat.localActions.values()].find((action) => action.request === request)
    if (local?.row.node.isConnected) {
      const kind = request.permission ? 'permission' : 'pending'
      if (local.row.state.dataset['state'] !== kind) chat.setStatus(local.row, kind, request.state.textContent)
      else chat.setStatusLabel(local.row, request.state.textContent)
    }
  }

  chat.complete = (id, event, data, label, at = Date.now()) => {
    const request = chat.messages.get(id)
    if (!request || request.completed) return
    request.completed = true
    request.state.textContent = t.duration.replace('{n}', (Math.max(0, at - request.started) / 1000).toFixed(1))
    chat.record(id, event, data, label, at)
    const local = chat.localActions.get(id)
    if (local) {
      chat.setStatus(local.row, 'done', request.state.textContent)
      local.row.pending = false
      chat.updateSend()
    }
  }

  async function copyProposal(text: string, result: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      result.textContent = t.textCopied
    } catch {
      result.textContent = t.textCopyFailed
    }
  }

  function addSuggestion(data: Fields, at = Date.now()): void {
    const id = str(data['id'])
    const to = str(data['to'])
    const text = str(data['text'])
    if (chat.suggestions.has(id)) return
    chat.complete(to, 'suggestion', data, t.proposal, at)
    const node = element('article', undefined, 'hc-proposal')
    const result = element('p')
    const controls = element('div')
    controls.append(
      button(t.insert, () => {
        const editor = chat.editor
        if (!editor) {
          result.textContent = t.noField
          return
        }
        const field = editor.textarea
        if (editor.insert(field.selectionStart, field.selectionEnd, text)) {
          controls.remove()
          result.textContent = t.applied
        } else result.textContent = t.failed
      }),
      button(t.copyText, () => void copyProposal(text, result)),
      button(t.discard, () => node.remove()),
    )
    node.append(element('p', t.proposal, 'hc-byline'), element('pre', text), controls, result)
    chat.suggestions.set(id, { data, node, result, controls, at })
    const parent = chat.messages.get(to)?.children ?? ui.list
    parent.append(node)
    if (chat.localActions.has(to)) chat.applySuggestion(id)
    else if (!chat.replaying && chat.rewritesSending === 0) chat.setOpen(true, false)
  }

  chat.applySuggestion = (id) => {
    const card = chat.suggestions.get(id)
    if (!card) return
    const to = str(card.data['to'])
    const local = chat.localActions.get(to)
    if (!local) return
    const { target, draft, selection } = local
    const start = selection?.start ?? 0
    const end = selection?.end ?? draft.length
    const unchanged = selection
      ? target.textarea.value.slice(start, end) === draft.slice(start, end)
      : target.textarea.value === draft
    if (chat.editor === target && unchanged && target.insert(start, end, str(card.data['text']))) {
      card.controls.remove()
      card.result.textContent = t.applied
      // the proposal can be taken back from the row, as Ctrl+Z does
      if (local.row.node.isConnected) local.row.undo.hidden = false
    } else chat.setOpen(true, false)
    chat.localActions.delete(to)
  }

  chat.receive = ({ event, data, open, at }: Entry) => {
    switch (event) {
      case 'message':
        chat.addMessage(data, undefined, at)
        break
      case 'delivered': {
        const id = str(data['id'])
        chat.deliveries.set(id, { data, at })
        const request = chat.messages.get(id)
        if (request) {
          request.delivered = true
          chat.record(id, event, data, t.delivered, at)
          chat.updateState(request)
        }
        break
      }
      case 'suggestion':
        addSuggestion(data, at)
        break
      case 'reply':
        addReply(data, at)
        break
      case 'permission': {
        const row = chat.rewriteRow
        if (chat.rewritesSending && row?.pending) {
          row.earlyPermissions.push({ data, at })
          chat.setStatus(row, 'permission', t.waitingPermission)
        }
        for (const [id, request] of chat.messages)
          if (!request.completed) {
            request.permission = open === true
            chat.record(id, event, data, t.permission, at)
            chat.updateState(request)
          }
        addPermission(data, open === true)
        break
      }
      case 'status': {
        const stopped = chat.background !== null
        chat.background = (data['background'] as Chat['background'] | undefined) ?? null
        chat.setAvailable((data['available'] as Chat['available'] | undefined) ?? [])
        chat.setConnected(data['connected'] === true)
        chat.setAgent(data['connected'] === true && typeof data['agent'] === 'string' ? data['agent'] : undefined)
        if (!chat.connected)
          for (const card of chat.permissions) if (card.open) chat.finish(card, stopped ? t.deniedOnStop : t.answered)
        break
      }
      case 'notice':
        addNotice(data, at)
        break
    }
  }
}
