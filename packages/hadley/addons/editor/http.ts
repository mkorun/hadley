/** What the editor's routes share: the language of a request, its body read with limits, and a JSON answer. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveLang, t, type Lang } from './i18n.ts'

// The language comes from the client as the query parameter `?lang=` (see i18n.ts), alike for GET and POST, however
// far the JSON body could be parsed.
export function getLang(req: IncomingMessage): Lang {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return resolveLang(url.searchParams.get('lang'))
}

// The writes wait for each other (oneAtATime), so a body that never ends must not hold the ones after it
export async function readBytes(req: IncomingMessage, lang: Lang, maxBytes: number, maxMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const late = setTimeout(() => {
      reject(new Error(t(lang, 'requestBodyTooSlow')))
      req.destroy()
    }, maxMs)
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        clearTimeout(late)
        reject(new Error(t(lang, 'requestBodyTooLarge')))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      clearTimeout(late)
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (error) => {
      clearTimeout(late)
      reject(error)
    })
  })
}

export async function readBody(
  req: IncomingMessage,
  lang: Lang,
  maxBytes = 1_048_576,
  maxMs = 10_000,
): Promise<string> {
  const bytes = await readBytes(req, lang, maxBytes, maxMs)
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error(t(lang, 'requestBodyInvalidUtf8'))
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(json)
}
