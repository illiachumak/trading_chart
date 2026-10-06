import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountStore } from '@/lib/realtime/account-store'
import { ChartFeeder } from '@/lib/realtime/chart-feeder'
import { MarketClient } from '@/lib/realtime/market-client'
import { MarketRuntime } from '@/lib/realtime/market-runtime'
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
  it('delivers quote answers to the ticket and to a probe on one connection when RTT exceeds the refresh interval', async () => {
    const { worker } = createInProcessWorker(DEFAULT_SERVER_CONFIG, 7)
    const client = new MarketClient({
      createSocket: createWorkerSocketFactory(worker),
      random: () => 0.5,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
      resyncTimeoutMs: 300,
      maxPendingMessages: 5_000,
    })
    const account = new AccountStore()
    account.attach(client)
    const probeAnswers: number[] = []
    client.onMessage((message) => {
      if (message.type === 'quote_result' && message.quote.requestId >= 1_000_000_000) {
        probeAnswers.push(message.quote.requestId)
      }
    })
    client.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(client.getStatus()).toBe('live')
    client.send({ type: 'dev', command: { kind: 'set_latency', ms: 600 } })
    // Ticket refreshes every 250 ms while answers take 600 ms; a probe quote goes out on the same connection.
    for (let i = 0; i < 8; i++) {
      account.requestQuote('yes', 10, 0.03)
      if (i === 2) client.send({ type: 'quote', requestId: 1_000_000_000, side: 'no', amountUsd: 5, maxSlippage: 0.05 })
      await vi.advanceTimersByTimeAsync(250)
    }
    // Requests are still being superseded, yet an answer is already shown (no starvation).
    const midStream = account.store.getState().quote
    expect(midStream === 'none' ? 0 : midStream.requestId).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1_000)
    const quote = account.store.getState().quote
    expect(quote === 'none' ? 0 : quote.requestId).toBe(8)
    expect(probeAnswers).toEqual([1_000_000_000])
    expect(client.stats.gaps).toBe(0)
    client.stop()
  })

  it('rebuilds the exact server chart through drops, latency and disconnects', async () => {
    const { worker, server, pause } = createInProcessWorker(DEFAULT_SERVER_CONFIG, 7)
    const client = new MarketClient({
      createSocket: createWorkerSocketFactory(worker),
      random: () => 0.5,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
      resyncTimeoutMs: 300,
      maxPendingMessages: 5_000,
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
    const account = new AccountStore()
    account.attach(client)
    const userTrades: string[] = []
    client.onMessage((message) => {
      if (message.type !== 'trades') return
      for (const trade of message.items) if (trade.source === 'user') userTrades.push(trade.clientOrderId)
    })
    const dev = (command: DevCommand) => client.send({ type: 'dev', command })

    client.start()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(client.getStatus()).toBe('live')
    dev({ kind: 'set_drop_rate', rate: 0.2 })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getStatus()).toBe('live')
    // Place an order right before the first disconnect; it must be applied exactly once.
    account.placeOrder({
      clientOrderId: 'e2e-order',
      roundId: 1,
      side: 'yes',
      amountUsd: 10,
      expectedPrice: 0.99,
      maxSlippage: 0.1,
    })
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
    expect(account.store.getState().account).toEqual(midTruth.account)
    expect(userTrades.filter((id) => id === 'e2e-order')).toHaveLength(1)
    const order = account.store.getState().order
    expect(order.kind).toBe('done')
    if (order.kind === 'done') expect(order.result.status).toBe('filled')
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

  it('compact aggregation at 5,000 trades/s and 16 ms batches still rebuilds the exact server chart', async () => {
    // Short rounds so the run also crosses round boundaries (rollover flushes are compacted too).
    const config = { ...DEFAULT_SERVER_CONFIG, tradesPerSec: 5_000, batchIntervalMs: 16, roundMs: 4_000 }
    expect(config.aggregation).toBe('compact')
    const { worker, server, pause } = createInProcessWorker(config, 11)
    const client = new MarketClient({
      createSocket: createWorkerSocketFactory(worker),
      random: () => 0.5,
      backoffBaseMs: 100,
      backoffMaxMs: 1_000,
      resyncTimeoutMs: 300,
      maxPendingMessages: 5_000,
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
    let lastPrice = 0
    const userTrades: string[] = []
    client.onMessage((message) => {
      if (message.type !== 'trades') return
      lastPrice = message.items.at(-1)?.priceAfter ?? lastPrice
      for (const trade of message.items) if (trade.source === 'user') userTrades.push(trade.clientOrderId)
    })
    const account = new AccountStore()
    account.attach(client)

    client.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(client.getStatus()).toBe('live')
    const startStats = { ...client.stats }
    account.placeOrder({
      clientOrderId: 'compact-order',
      roundId: server.getSnapshot().round.id,
      side: 'yes',
      amountUsd: 10,
      expectedPrice: 0.99,
      maxSlippage: 0.1,
    })
    await vi.advanceTimersByTimeAsync(5_500)
    pause()
    await vi.advanceTimersByTimeAsync(500)

    const trades = client.stats.trades - startStats.trades
    const items = client.stats.tradeItems - startStats.tradeItems
    expect(trades).toBeGreaterThan(20_000)
    // ~80 trades per 16 ms batch, of which the newest 12 plus second-closers and user trades ship.
    expect(items * 4).toBeLessThan(trades)
    expect(client.getLastSeq()).toBe(server.getLastSeq())
    const truth = server.getSnapshot()
    expect(truth.round.id).toBeGreaterThan(1)
    expect(truth.history.length).toBeGreaterThan(1)
    expect(feeder.getHistory()).toEqual(truth.history)
    expect(lastPrice).toBe(truth.price)
    // User trades are never aggregated away.
    expect(userTrades).toEqual(['compact-order'])
    client.stop()
    feeder.dispose()
  })

  it('resets the client cleanly on reset_market, with messages around the reset being dropped', async () => {
    // Short rounds so the reset goes from round 3 back to round 1.
    const { worker, server, pause } = createInProcessWorker({ ...DEFAULT_SERVER_CONFIG, roundMs: 5_000 }, 3)
    const runtime = new MarketRuntime(() => worker)
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
    runtime.client.onMessage((message) => feeder.handle(message))
    const seqs: number[] = []
    runtime.client.onMessage((message) => seqs.push(message.seq))
    const dev = (command: DevCommand) => runtime.send({ type: 'dev', command })

    runtime.start()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(runtime.client.getStatus()).toBe('live')
    expect(server.getSnapshot().round.id).toBe(3)
    dev({ kind: 'set_balance', usd: 7 })
    dev({ kind: 'set_drop_rate', rate: 0.5 })
    await vi.advanceTimersByTimeAsync(1_030)
    dev({ kind: 'reset_market', seed: 21 })
    dev({ kind: 'set_drop_rate', rate: 0 })
    await vi.advanceTimersByTimeAsync(3_000)
    pause()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(runtime.client.getStatus()).toBe('live')
    // Drops around the reset forced resyncs; the replay ring spans the reset (see the server tests).
    expect(runtime.client.stats.gaps).toBeGreaterThan(0)
    expect(runtime.client.getLastSeq()).toBe(server.getLastSeq())
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    const truth = server.getSnapshot()
    expect(truth.round.id).toBe(1)
    expect(truth.history.length).toBeGreaterThan(1)
    expect(feeder.getHistory()).toEqual(truth.history)
    const market = runtime.market.store.getState()
    if (market.phase !== 'ready') throw new Error('market not ready')
    expect(market.round).toEqual(truth.round)
    expect(market.price).toBe(truth.price)
    expect(new Set(market.recentTrades.map((t) => t.id)).size).toBe(market.recentTrades.length)
    expect(runtime.account.store.getState().account).toEqual(truth.account)
    expect(truth.account.balance).toBe(DEFAULT_SERVER_CONFIG.startBalance)
    runtime.stop()
    feeder.dispose()
  })
})
