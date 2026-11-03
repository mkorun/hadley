import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { it } from 'node:test'
import { closeServer } from './support.ts'

it('starts server.close before forcing connections closed, as Bun 1.4.0 requires', async () => {
  const calls: string[] = []
  const server = {
    close(callback: (error?: Error) => void) {
      calls.push('close')
      queueMicrotask(() => callback())
    },
    closeAllConnections() {
      assert.deepEqual(calls, ['close'])
      calls.push('closeAllConnections')
    },
  } as unknown as Pick<Server, 'close' | 'closeAllConnections'>
  await closeServer(server)
  assert.deepEqual(calls, ['close', 'closeAllConnections'])
})
