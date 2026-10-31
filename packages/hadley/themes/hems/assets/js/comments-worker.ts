// hems: solves the comments service's Altcha challenge (assets/js/comments.ts) with the browser's own SubtleCrypto:
// it looks for the counter for which PBKDF2(nonce + counter, salt) begins with keyPrefix.

type WorkerInput = {
  nonce: string
  salt: string
  cost: number
  keyLength: number
  keyPrefix: string
}

type WorkerOutput = { ok: true; counter: number; derivedKey: string } | { ok: false }

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { nonce, salt, cost, keyLength, keyPrefix } = e.data

  const nonceBytes = hexToBytes(nonce)
  const saltBytes = hexToBytes(salt)
  const prefixBytes = hexToBytes(keyPrefix)
  const bits = keyLength * 8

  // the password: the nonce, then the counter in 4 bytes, big-endian
  const password = new Uint8Array(nonceBytes.length + 4)
  password.set(nonceBytes)
  const view = new DataView(password.buffer)

  let counter = 0

  while (true) {
    view.setUint32(nonceBytes.length, counter, false)

    const keyMaterial = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits'])
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: cost, hash: 'SHA-256' },
        keyMaterial,
        bits,
      ),
    )

    if (startsWith(derived, prefixBytes)) {
      const msg: WorkerOutput = { ok: true, counter, derivedKey: bytesToHex(derived) }
      self.postMessage(msg)
      return
    }

    counter++

    // now and then a pause, so that the worker can be stopped
    if (counter % 10 === 0) await delay()
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function startsWith(arr: Uint8Array, prefix: Uint8Array): boolean {
  for (let i = 0; i < prefix.length; i++) if (arr[i] !== prefix[i]) return false
  return true
}

function delay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}
