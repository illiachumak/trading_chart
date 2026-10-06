import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketRuntime } from '@/lib/realtime/market-runtime'
import { selectRound } from '@/lib/realtime/market-store'
import { DEFAULT_SERVER_CONFIG } from '@/server/mock-server'
import { createInProcessWorker } from '@/test-utils/in-process-worker'

beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MarketRuntime', () => {
  it('survives a StrictMode-style start/stop/start and goes live', async () => {
    const workers: ReturnType<typeof createInProcessWorker>[] = []
    const runtime = new MarketRuntime(() => {
      const created = createInProcessWorker(DEFAULT_SERVER_CONFIG, workers.length + 1)
      workers.push(created)
      return created.worker
    })
    runtime.start()
    runtime.stop()
    runtime.start()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(workers).toHaveLength(2)
    expect(runtime.client.getStatus()).toBe('live')
    expect(selectRound(runtime.market.store.getState())).not.toBe('loading')
    expect(runtime.account.store.getState().account).not.toBe('loading')

    runtime.stop()
    expect(runtime.client.getStatus()).toBe('idle')
    expect(runtime.market.store.getState().phase).toBe('loading')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start is idempotent while running', () => {
    let created = 0
    const runtime = new MarketRuntime(() => {
      created++
      return createInProcessWorker(DEFAULT_SERVER_CONFIG, created).worker
    })
    runtime.start()
    runtime.start()
    expect(created).toBe(1)
    runtime.stop()
  })
})
