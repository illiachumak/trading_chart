import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWorkerToMain } from '@/lib/realtime/bridge'
import { parseServerMessage } from '@/lib/realtime/protocol'
import { DEFAULT_SERVER_CONFIG } from '@/server/mock-server'
import { createInProcessWorker } from '@/test-utils/in-process-worker'

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})
afterEach(() => {
  vi.useRealTimers()
})

async function countTradesPerSecond(batchMs: number | undefined): Promise<number> {
  const { worker } = createInProcessWorker({ ...DEFAULT_SERVER_CONFIG, tradesPerSec: 100 }, 5)
  let trades = 0
  worker.addEventListener('message', (event) => {
    if (!isWorkerToMain(event.data) || event.data.kind !== 'data') return
    const parsed = parseServerMessage(event.data.data)
    if (parsed !== 'invalid' && parsed.type === 'trades') trades += 1
  })
  worker.postMessage({ kind: 'connect', connId: 1 })
  if (batchMs !== undefined) {
    const command = { type: 'dev', command: { kind: 'set_batch_interval', ms: batchMs } }
    worker.postMessage({ kind: 'data', connId: 1, data: JSON.stringify(command) })
  }
  await vi.advanceTimersByTimeAsync(10)
  trades = 0
  await vi.advanceTimersByTimeAsync(5_000)
  worker.terminate()
  return trades / 5
}

describe('in-process worker batch loop', () => {
  it('flushes ~10 trade batches per second by default and ~30 at 33 ms', async () => {
    const normal = await countTradesPerSecond(undefined)
    expect(normal).toBeGreaterThan(8)
    expect(normal).toBeLessThan(11)
    const fast = await countTradesPerSecond(33)
    expect(fast).toBeGreaterThan(26)
    expect(fast).toBeLessThan(32)
  })

  it('keeps the feed running after a tick throws', async () => {
    const { worker, server } = createInProcessWorker({ ...DEFAULT_SERVER_CONFIG, tradesPerSec: 100 }, 5)
    let ticks = 0
    vi.spyOn(server, 'tick').mockImplementation(() => {
      ticks += 1
      if (ticks === 1) throw new Error('boom')
    })
    // The first scheduled loop throws; vitest surfaces it as an unhandled timer error, so catch it here.
    await expect(vi.advanceTimersByTimeAsync(150)).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(350)
    expect(ticks).toBeGreaterThan(2)
    worker.terminate()
  })

  it('cancels every pending timer on pause and terminate', async () => {
    const paused = createInProcessWorker(DEFAULT_SERVER_CONFIG, 1)
    await vi.advanceTimersByTimeAsync(350)
    paused.pause()
    expect(vi.getTimerCount()).toBe(0)
    const stopped = createInProcessWorker(DEFAULT_SERVER_CONFIG, 1)
    await vi.advanceTimersByTimeAsync(350)
    stopped.worker.terminate()
    expect(vi.getTimerCount()).toBe(0)
  })
})
