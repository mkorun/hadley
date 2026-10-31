/**
 * What the dev server answers at all (docs/dev-server.md), checked before anything else sees a request, the block
 * editor and the comments proxy among them: a path that names nothing above the output directory, a Host it serves,
 * a write of the editor (`POST /__hadley/…`) only from this machine and from the page's own origin, and a read of a
 * block's source (`GET /__hadley/block/…`) only from this machine and never for another origin; both under the dev
 * server's own host, so not through a tunnel, which arrives from this machine. Vite's `/__open-in-editor` is refused:
 * any page a browser shows could call it.
 */
import { isIP } from 'node:net'

/** Why a request is refused, with its status, or undefined. */
export function refusal(
  request: {
    method?: string | undefined
    url?: string | undefined
    headers: Record<string, string | string[] | undefined>
  },
  remoteAddress: string | undefined,
  allowed: { origin: string; hosts: readonly string[] }, // hosts: names, and `.domain` for a domain and its subdomains
): { status: number; reason: string } | undefined {
  const url = request.url ?? '/'
  // a browser asks for a path; an absolute address (`GET http://host/path`) would be read as a path only behind this
  if (!url.startsWith('/')) return { status: 400, reason: 'an address that is not a path' }
  let path: string
  try {
    path = decodeURIComponent(url.split('?')[0]!.split('#')[0]!)
  } catch {
    return { status: 400, reason: 'a path that is not percent-encoded right' }
  }
  // as a browser and Vite's proxy read it: . and .. segments, either slash, and what the encoding hid
  if (
    path.includes('\0') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '..' || segment === '.')
  )
    return { status: 400, reason: 'a path with . or .. segments' }

  // HTTP/2, which Vite speaks over TLS, names it :authority
  const host = String(request.headers.host ?? request.headers[':authority'] ?? '')
  // [::1]:8000, or a name or IPv4 address with its port
  const name = /^\[(.*)\](?::\d+)?$/.exec(host)?.[1] ?? host.replace(/:\d+$/, '')
  const known =
    name === 'localhost' ||
    isIP(name) !== 0 ||
    allowed.hosts.some((entry) =>
      entry.startsWith('.') ? name === entry.slice(1) || name.endsWith(entry) : name === entry,
    )
  if (!known) return { status: 403, reason: `the host ${host || '(none)'}` }

  if (path.startsWith('/__open-in-editor')) return { status: 404, reason: 'a path for no one' }

  const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
  const ownHost = host === new URL(allowed.origin).host
  if (request.method === 'POST' && path.startsWith('/__hadley/')) {
    if (!loopback || !ownHost || request.headers.origin !== allowed.origin)
      return { status: 403, reason: 'an editor write from another machine or origin' }
  }
  // a browser sends no Origin with a GET of its own origin, but one, and Sec-Fetch-Site, with a request of another
  if (request.method !== 'POST' && path.startsWith('/__hadley/block/')) {
    const origin = request.headers.origin
    const site = request.headers['sec-fetch-site']
    if (
      !loopback ||
      !ownHost ||
      (origin !== undefined && origin !== allowed.origin) ||
      (site !== undefined && site !== 'same-origin')
    )
      return { status: 403, reason: 'a read of the source from another machine or origin' }
  }
  return undefined
}
