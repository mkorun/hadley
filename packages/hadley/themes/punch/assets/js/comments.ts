// punch: the comment form (templates/partials/comment-form.sort). Opening it fetches an Altcha challenge from the
// comments service, which a worker solves (assets/js/comments-worker.ts) while the visitor writes; the comment is
// sent with the solution (services/forms/CONTRACT.md).

type AltchaChallenge = {
  parameters: { nonce: string; salt: string; cost: number; keyLength: number; keyPrefix: string; expiresAt: string }
  signature: string
}
type AltchaSolution = { counter: number; derivedKey: string }

const dialog = document.querySelector<HTMLDialogElement>('.comment-dialog')
const form = dialog?.querySelector('form')
const submit = form?.querySelector<HTMLButtonElement>('[type="submit"]')
const errorLine = dialog?.querySelector<HTMLElement>('.form-error')

let challenge: AltchaChallenge | null = null
let solution: AltchaSolution | null = null
let worker: Worker | null = null

// what the server does to a field too (sanitizeField): NFC, and no control or direction characters
const sanitize = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F​-‍‪-‮⁠-⁤﻿]/g, '')
    .trim()

const text = (key: string) => dialog?.dataset[key] ?? ''
const errorText = (status: number | 'network') => text(`i18nError${status === 'network' ? 'Network' : status}`)

function setReady(ready: boolean): void {
  if (!submit) return
  submit.setAttribute('aria-disabled', String(!ready))
  submit.textContent = ready ? text('i18nSubmit') : text('i18nWaiting')
}

function showError(message: string): void {
  if (errorLine) {
    errorLine.textContent = message
    errorLine.hidden = false
  }
  setReady(true)
}

function clearError(): void {
  if (errorLine) {
    errorLine.textContent = ''
    errorLine.hidden = true
  }
}

async function fetchChallenge(): Promise<void> {
  challenge = null
  solution = null
  setReady(false)
  try {
    const response = await fetch(`${text('serviceUrl')}/api/comment/token`)
    if (response.status === 429 || response.status === 503) return showError(errorText(response.status))
    if (!response.ok) return showError(errorText('network'))
    challenge = (await response.json()) as AltchaChallenge
  } catch {
    return showError(errorText('network'))
  }

  worker?.terminate()
  // the worker's URL as the page names it: a publish build writes it under the hash of its bytes
  const workerUrl = document.querySelector<HTMLScriptElement>('script[data-worker]')?.dataset.worker
  if (!workerUrl) return showError(errorText('network'))
  worker = new Worker(new URL(workerUrl, import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ ok: boolean; counter: number; derivedKey: string }>) => {
    if (!event.data.ok) return showError(errorText('network'))
    solution = { counter: event.data.counter, derivedKey: event.data.derivedKey }
    setReady(true)
  }
  worker.onerror = () => showError(errorText('network'))
  const { nonce, salt, cost, keyLength, keyPrefix } = challenge.parameters
  worker.postMessage({ nonce, salt, cost, keyLength, keyPrefix })
}

const solved = () =>
  new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (solution) {
        clearInterval(check)
        resolve()
      }
    }, 100)
  })

const send = (payload: object) =>
  fetch(`${text('serviceUrl')}/api/comment/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

function succeeded(): void {
  dialog?.close()
  const success = document.querySelector<HTMLElement>('.comment-success')
  if (success) success.hidden = false
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault()
  if (!form) return
  clearError()
  if (!solution) {
    setReady(false)
    await solved()
  }

  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const notify = field('notify').checked
  const email = field('email').value.trim().toLowerCase()
  // an email address is needed for a notification (the server checks it too)
  if (notify && !email) return showError(text('i18nErrorEmail'))

  const payload = {
    altcha: { challenge, solution },
    article_id: text('articleId'),
    language_version: text('lang'),
    parent_comment_id: null,
    name: sanitize(field('name').value),
    email,
    text: sanitize(field('text').value),
    notify,
  }

  setReady(false)
  try {
    let response = await send(payload)
    // 422: the challenge expired; solve a new one and send again
    if (response.status === 422) {
      await fetchChallenge()
      if (!challenge) return
      await solved()
      response = await send({ ...payload, altcha: { challenge, solution } })
    }
    if (response.status === 201) return succeeded()
    showError(errorText(response.status) || errorText('network'))
  } catch {
    showError(errorText('network'))
  }
}

if (dialog && form) {
  const open = document.querySelector<HTMLButtonElement>('.comment-open')
  if (open) {
    open.hidden = false
    open.addEventListener('click', () => {
      clearError()
      form.reset()
      dialog.showModal()
      void fetchChallenge()
    })
  }
  form.addEventListener('submit', (event) => void handleSubmit(event))
  dialog.addEventListener('close', () => {
    worker?.terminate()
    worker = null
  })
  // a click on the backdrop closes it
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close())
}
