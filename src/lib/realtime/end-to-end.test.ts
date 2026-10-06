import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartFeeder } from '@/lib/realtime/chart-feeder'
import { MarketClient } from '@/lib/realtime/market-client'
import { createWorkerSocketFactory } from '@/lib/realtime/mock-socket'
import type { DevCommand } from '@/lib/realtime/protocol'
import { DEFAULT_SERVER_CONFIG } from '@/server/mock-server'
import { createInProcessWorker } from '@/test-utils/in-process-worker'

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('client + mock server end to end', () => {
  it('rebuilds the exact server chart through drops, latency and disconnects', async () => {
    const { worker, server, pause } = createInProcessWorker(DEFAULT_SERVER_CONFIG, 7)
    const client = new MarketClient({
      createSocket: createWorkerSocketFactory(worker),
      random: () => 0.5,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
      resyncTimeoutMs: 300,
    })
    const feeder = new ChartFeeder(
      { update: () => {}, setData: () => {} },
      {
        scheduler: {
          request: (callback) => {
            const timer = setTimeout(callback, 16)
            return () => clearTimeout(timer)
          },
        },
        perfNow: () => 0,
        serverNow: () => Date.now(),
        backlogThreshold: 30,
        onFlush: () => {},
      },
    )
    client.onMessage((message) => feeder.handle(message))
    const seqs: number[] = []
    client.onMessage((message) => seqs.push(message.seq))
    const dev = (command: DevCommand) => client.send({ type: 'dev', command })

    client.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'set_drop_rate', rate: 0.2 })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'force_disconnect' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'set_latency', ms: 150 })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'force_disconnect' })
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'set_drop_rate', rate: 0 })
    dev({ kind: 'set_latency', ms: 0 })
    // Mid-round check at t = 50.05 s: the last 100 ms tick (t = 50.0 s) has been delivered
    // and its 16 ms frame flushed; the next tick is at 50.1 s, so nothing is in flight.
    await vi.advanceTimersByTimeAsync(1_050)
    const midTruth = server.getSnapshot()
    expect(midTruth.round.id).toBe(1)
    expect(midTruth.history.length).toBeGreaterThan(30)
    expect(feeder.getHistory()).toEqual(midTruth.history)
    await vi.advanceTimersByTimeAsync(18_950) // crosses the 60 s round boundary
    pause()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(client.getStatus()).toBe('live')
    expect(client.stats.gaps).toBeGreaterThan(0)
    expect(client.stats.reconnects).toBe(2)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    expect(client.getLastSeq()).toBe(server.getLastSeq())
    const truth = server.getSnapshot()
    expect(truth.round.id).toBe(2)
    expect(truth.history.length).toBeGreaterThan(0)
    expect(feeder.getHistory()).toEqual(truth.history)
    client.stop()
    feeder.dispose()
  })
})
