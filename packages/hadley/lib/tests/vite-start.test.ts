import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startVite } from '../vite-start.ts'

// a server whose listen() answers, hangs or fails, as told, and which counts what is asked of it
const server = (listen: 'answers' | 'hangs' | 'fails') => {
  const calls = { listen: 0, close: 0 }
  return {
    calls,
    listen: () => {
      calls.listen++
      if (listen === 'answers') return Promise.resolve()
      if (listen === 'fails') return Promise.reject(new Error('port 8000 is already in use'))
      return new Promise<void>(() => {})
    },
    close: () => {
      calls.close++
      return Promise.resolve()
    },
  }
}

// makes the servers in turn, and keeps what it was told
const run = async (servers: ReturnType<typeof server>[], bound = false) => {
  const warnings: string[] = []
  let made = 0
  const started = await startVite(async () => servers[made++]!, {
    port: 8000,
    stallMs: 20,
    bound: async () => bound,
    warn: (message) => warnings.push(message),
  })
  return { started, warnings, made }
}

// 2026-11-05: listen() hung on macOS (Intel) and on Windows in the CI, after it had on Linux; a second start never did
describe('the start of Vite', () => {
  it('takes a server that starts at once, and says nothing', async () => {
    const first = server('answers')
    const { started, warnings, made } = await run([first])
    assert.equal(started, first)
    assert.deepEqual(warnings, [])
    assert.equal(made, 1)
  })

  it('makes a server anew once when the first hangs before its port answers', async () => {
    const [first, second] = [server('hangs'), server('answers')]
    const { started, warnings, made } = await run([first, second])
    assert.equal(started, second)
    assert.equal(made, 2)
    assert.equal(first.calls.close, 1)
    assert.match(warnings.join('\n'), /^Vite has not started after 0\.02 s, and port 8000 is free: starting it again$/)
  })

  it('goes on with a server whose port answers, though its listen() has not', async () => {
    const first = server('hangs')
    const { started, warnings, made } = await run([first], true)
    assert.equal(started, first)
    assert.equal(made, 1)
    assert.equal(first.calls.close, 0)
    assert.match(warnings.join('\n'), /port 8000 answers: going on/)
  })

  it('stops after a second start that hangs as well', async () => {
    await assert.rejects(
      run([server('hangs'), server('hangs')]),
      /^Error: Vite has not started twice, 0\.02 s each, and port 8000 is free: start hadley dev again$/,
    )
  })

  it('passes a failure of listen() on, without a second start', async () => {
    const second = server('answers')
    await assert.rejects(run([server('fails'), second]), /already in use/)
    assert.equal(second.calls.listen, 0)
  })
})
