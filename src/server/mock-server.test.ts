import { describe, expect, it } from 'vitest'
import {
  BATCH_INTERVAL_MS,
  FEED_TRADES_PER_BATCH,
  MAX_BATCH_INTERVAL_MS,
  MIN_BATCH_INTERVAL_MS,
  START_BALANCE,
} from '@/config/market'
import type { WorkerToMain } from '@/lib/realtime/bridge'
import { type ClientMessage, parseServerMessage, type ServerMessage, type Trade } from '@/lib/realtime/protocol'
import { DEFAULT_SERVER_CONFIG, MockServer, type ServerConfig } from '@/server/mock-server'
import { createRng } from '@/server/rng'

type Timer = { fn: () => void; due: number; order: number }

/** `timerJitterMs` makes timers fire late, like real `setTimeout` under load. */
function setup(overrides: Partial<ServerConfig> = {}, timerJitterMs = 0, seed = 42) {
  let now = 0
  /** Fake monotonic clock: every read advances it by 3 ms, so each tick measures exactly 3 ms. */
  let perf = 0
  let timerOrder = 0
  const posted: WorkerToMain[] = []
  const deliveredAt: number[] = []
  let timers: Timer[] = []
  const server = new MockServer(
    {
      post: (message) => {
        posted.push(message)
        deliveredAt.push(now)
      },
      now: () => now,
      perfNow: () => (perf += 3),
      rng: createRng(seed),
      schedule: (fn, ms) => timers.push({ fn, due: now + ms + timerJitterMs, order: timerOrder++ }),
    },
    { ...DEFAULT_SERVER_CONFIG, ...overrides },
  )
  /** Moves the clock to `until`, firing due timers in (due, creation) order. */
  const advanceTo = (until: number): void => {
    for (;;) {
      const due = timers.filter((t) => t.due <= until).sort((a, b) => a.due - b.due || a.order - b.order)
      if (due.length === 0) break
      const [next] = due
      timers = timers.filter((t) => t !== next)
      now = Math.max(now, next.due)
      next.fn()
    }
    now = until
  }
  const messagesFor = (connId: number): ServerMessage[] =>
    posted.flatMap((p) => {
      if (p.kind !== 'data' || p.connId !== connId) return []
      const parsed = parseServerMessage(p.data)
      return parsed === 'invalid' ? [] : [parsed]
    })
  return {
    server,
    posted,
    deliveredAt,
    messagesFor,
    pendingTimers: () => timers.length,
    advanceTo,
    now: () => now,
    tickFor(ms: number) {
      for (let t = 0; t < ms; t += 100) {
        advanceTo(now + 100)
        server.tick()
      }
    },
    connect(connId: number) {
      server.onBridgeMessage({ kind: 'connect', connId })
    },
    send(connId: number, message: ClientMessage) {
      server.onBridgeMessage({ kind: 'data', connId, data: JSON.stringify(message) })
    },
  }
}

describe('MockServer', () => {
  it('reports the configured batch interval and clamps dev changes to the allowed range', () => {
    const t = setup()
    expect(t.server.getBatchIntervalMs()).toBe(BATCH_INTERVAL_MS)
    t.connect(1)
    const setMs = (ms: number) => t.send(1, { type: 'dev', command: { kind: 'set_batch_interval', ms } })
    setMs(33)
    expect(t.server.getBatchIntervalMs()).toBe(33)
    setMs(1)
    expect(t.server.getBatchIntervalMs()).toBe(MIN_BATCH_INTERVAL_MS)
    setMs(60_000)
    expect(t.server.getBatchIntervalMs()).toBe(MAX_BATCH_INTERVAL_MS)
    expect(setup({ batchIntervalMs: 50 }).server.getBatchIntervalMs()).toBe(50)
  })

  it('set_balance publishes an account payload with the new balance', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_balance', usd: 250 } })
    const accounts = t.messagesFor(1).flatMap((m) => (m.type === 'account' ? [m.account] : []))
    expect(accounts.at(-1)?.balance).toBe(250)
    t.send(1, { type: 'dev', command: { kind: 'set_balance', usd: -5 } })
    expect(t.messagesFor(1).flatMap((m) => (m.type === 'account' ? [m.account] : [])).at(-1)?.balance).toBe(250)
  })

  it('compacts trade batches by default and ships every trade in full mode', () => {
    const t = setup({ tradesPerSec: 5_000 })
    expect(DEFAULT_SERVER_CONFIG.aggregation).toBe('compact')
    t.connect(1)
    t.tickFor(1_000)
    const batches = (): Extract<ServerMessage, { type: 'trades' }>[] =>
      t.messagesFor(1).flatMap((m) => (m.type === 'trades' ? [m] : []))
    const compact = batches()
    expect(compact.length).toBeGreaterThan(5)
    let represented = 0
    for (const batch of compact) {
      expect(batch.items.length).toBeLessThanOrEqual(FEED_TRADES_PER_BATCH + 2)
      if (batch.aggregated === 'none') throw new Error('a ~500-trade batch must be aggregated')
      expect(batch.aggregated.count).toBeGreaterThan(300)
      represented += batch.items.length + batch.aggregated.count
    }
    // Trade ids start at 1 and the newest trade of a batch is always shipped: nothing is lost.
    expect(represented).toBe(compact.at(-1)?.items.at(-1)?.id)
    t.posted.length = 0
    t.send(1, { type: 'dev', command: { kind: 'set_aggregation', mode: 'full' } })
    t.tickFor(500)
    const full = batches()
    expect(full.length).toBeGreaterThan(3)
    for (const batch of full) {
      expect(batch.aggregated).toBe('none')
      expect(batch.items.length).toBeGreaterThan(300)
    }
  })

  it('accumulates tick timing and reports it on request (max resets per report)', () => {
    const t = setup()
    t.connect(1)
    const report = () => {
      t.posted.length = 0
      t.send(1, { type: 'dev', command: { kind: 'report_server_stats' } })
      const stats = t.messagesFor(1).filter((m) => m.type === 'server_stats')
      expect(stats).toHaveLength(1)
      return stats[0]
    }
    t.tickFor(1_000)
    expect(report()).toMatchObject({ type: 'server_stats', tickCount: 10, tickMsTotal: 30, tickMsMax: 3 })
    expect(report()).toMatchObject({ tickCount: 10, tickMsTotal: 30, tickMsMax: 0 })
    t.tickFor(500)
    expect(report()).toMatchObject({ tickCount: 15, tickMsTotal: 45, tickMsMax: 3 })
  })

  it('acknowledges a connection', () => {
    const t = setup()
    t.connect(1)
    expect(t.posted).toEqual([{ kind: 'open', connId: 1 }])
  })

  it('answers a fresh resync with a snapshot at the current seq', () => {
    const t = setup()
    t.connect(1)
    t.tickFor(1_000)
    t.posted.length = 0
    t.send(1, { type: 'resync', fromSeq: 1 })
    const [snapshot] = t.messagesFor(1)
    expect(snapshot.type).toBe('snapshot')
    expect(snapshot.seq).toBe(t.server.getLastSeq())
  })

  it('broadcasts batched trades ~10 times per second and replays a missed range', () => {
    const t = setup()
    t.connect(1)
    t.tickFor(2_000)
    const live = t.messagesFor(1)
    expect(live.length).toBeGreaterThan(10)
    expect(live.length).toBeLessThanOrEqual(20)
    expect(live.every((m) => m.type === 'trades')).toBe(true)
    const from = live[5].seq
    t.posted.length = 0
    t.send(1, { type: 'resync', fromSeq: from })
    expect(t.messagesFor(1).map((m) => m.seq)).toEqual(live.slice(5).map((m) => m.seq))
  })

  it('quotes and fills a user order', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 25, maxSlippage: 0.03 })
    const quoteMsg = t.messagesFor(1).find((m) => m.type === 'quote_result')
    if (quoteMsg?.type !== 'quote_result' || quoteMsg.quote.status !== 'ok') throw new Error('no quote')
    t.send(1, {
      type: 'place_order',
      clientOrderId: 'abc',
      roundId: 1,
      side: 'yes',
      amountUsd: 25,
      expectedPrice: quoteMsg.quote.avgPrice,
      maxSlippage: 0.1,
    })
    t.tickFor(100)
    const result = t.messagesFor(1).find((m) => m.type === 'order_result')
    expect(result).toMatchObject({ type: 'order_result', result: { clientOrderId: 'abc', status: 'filled' } })
  })

  it('force_disconnect closes the connection and stops delivery', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'force_disconnect' } })
    expect(t.posted).toContainEqual({ kind: 'closed', connId: 1 })
    t.posted.length = 0
    t.tickFor(500)
    expect(t.posted).toEqual([])
  })

  it('drops messages at the max drop rate but keeps advancing seq', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_drop_rate', rate: 0.9 } })
    t.tickFor(3_000)
    const seqs = t.messagesFor(1).map((m) => m.seq)
    const total = t.server.getLastSeq()
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs.length).toBeLessThan(total * 0.5)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    // A gap between consecutive delivered seqs proves drops happen after seq assignment.
    expect(seqs.some((seq, i) => i > 0 && seq - seqs[i - 1] > 1)).toBe(true)
  })

  it('suppresses delayed deliveries for a connection closed by force_disconnect', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 200 } })
    t.tickFor(300)
    expect(t.pendingTimers()).toBeGreaterThan(0)
    t.send(1, { type: 'dev', command: { kind: 'force_disconnect' } })
    t.posted.length = 0
    t.advanceTo(10_000)
    expect(t.posted).toEqual([])
  })

  it('delays delivery by the configured latency', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 200 } })
    t.posted.length = 0
    t.deliveredAt.length = 0
    t.tickFor(100)
    t.advanceTo(299)
    expect(t.messagesFor(1)).toEqual([])
    t.tickFor(1_000)
    const delivered = t.messagesFor(1)
    expect(delivered.length).toBeGreaterThan(5)
    // Trades batches are stamped with the publish time, so delivery - ts is the injected latency.
    delivered.forEach((m, i) => expect(t.deliveredAt[i] - m.ts).toBeGreaterThanOrEqual(200))
  })

  it('keeps per-connection delivery in order when latency is lowered and timers fire late', () => {
    const t = setup({}, 7)
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 300 } })
    t.posted.length = 0
    t.tickFor(500)
    t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 0 } })
    t.tickFor(1_000)
    t.advanceTo(10_000)
    const seqs = t.messagesFor(1).map((m) => m.seq)
    expect(seqs.length).toBeGreaterThan(10)
    // Nothing lost and nothing reordered: delivered seqs are exactly consecutive.
    seqs.forEach((seq, i) => expect(seq).toBe(seqs[0] + i))
  })

  it('never serves a snapshot with seq 0, even before the first tick', () => {
    const t = setup()
    t.connect(1)
    t.posted.length = 0
    t.send(1, { type: 'resync', fromSeq: 1 })
    const [snapshot] = t.messagesFor(1)
    expect(snapshot.type).toBe('snapshot')
    expect(snapshot.seq).toBeGreaterThanOrEqual(1)
    expect(snapshot.seq).toBe(1)
  })

  it('answers a resync from an up-to-date client with a fresh heartbeat', () => {
    const t = setup()
    t.connect(1)
    const lastSeq = t.server.getLastSeq()
    t.send(1, { type: 'resync', fromSeq: lastSeq + 1 })
    expect(t.messagesFor(1)).toEqual([{ type: 'heartbeat', ts: 0, seq: lastSeq + 1 }])
  })

  it('ignores data for unknown connections and garbage payloads', () => {
    const t = setup()
    t.server.onBridgeMessage({ kind: 'data', connId: 9, data: JSON.stringify({ type: 'resync', fromSeq: 1 }) })
    t.connect(1)
    t.server.onBridgeMessage({ kind: 'data', connId: 1, data: 'garbage' })
    expect(t.posted).toEqual([{ kind: 'open', connId: 1 }])
  })

  it('publishes a heartbeat with seq only after a quiet interval', () => {
    const t = setup()
    t.connect(1)
    t.advanceTo(999)
    t.server.heartbeat()
    expect(t.messagesFor(1)).toEqual([])
    t.advanceTo(1_000)
    t.server.heartbeat()
    expect(t.messagesFor(1)).toEqual([{ type: 'heartbeat', ts: 1_000, seq: t.server.getLastSeq() }])
  })

  it('skips heartbeats while trades are flowing', () => {
    const t = setup()
    t.connect(1)
    for (let i = 0; i < 5; i++) {
      t.tickFor(1_000)
      t.server.heartbeat()
    }
    expect(t.messagesFor(1).some((m) => m.type === 'heartbeat')).toBe(false)
  })

  it('does not let fault injection change the market', () => {
    const run = (dropRate: number): number[] => {
      const t = setup()
      t.connect(1)
      t.send(1, { type: 'dev', command: { kind: 'set_drop_rate', rate: dropRate } })
      t.tickFor(2_000)
      return t.server.getSnapshot().recentTrades.map((trade) => trade.priceAfter)
    }
    expect(run(0.5)).toEqual(run(0))
  })

  describe('reset_market', () => {
    const reset = (t: ReturnType<typeof setup>, seed: number): void =>
      t.send(1, { type: 'dev', command: { kind: 'reset_market', seed } })
    /** Ticks every `stepMs` until `ms` has passed since now. */
    const tickEvery = (t: ReturnType<typeof setup>, stepMs: number, ms: number): void => {
      const end = t.now() + ms
      while (t.now() < end) {
        t.advanceTo(Math.min(end, t.now() + stepMs))
        t.server.tick()
      }
    }
    const tradesAfter = (t: ReturnType<typeof setup>, seq: number): Trade[] =>
      t.messagesFor(1).flatMap((m) => (m.type === 'trades' && m.seq > seq ? m.items : []))
    /** Trade identity relative to the reset: ids keep counting across a reset, ts is relative to it. */
    const relative = (trades: readonly Trade[], resetAt: number) =>
      trades.map(({ ts, side, shares, priceAfter, source }) => ({ ts: ts - resetAt, side, shares, priceAfter, source }))

    it('replays the same trade sequence for the same seed, whatever came before and however often it ticks', () => {
      const run = (bootSeed: number, warmupMs: number, stepMs: number) => {
        const t = setup({ aggregation: 'full', tradesPerSec: 300, roundMs: 5_000 }, 0, bootSeed)
        t.connect(1)
        t.tickFor(warmupMs)
        // Off the tick grid on purpose: in the browser the reset lands between ticks.
        t.advanceTo(t.now() + 37)
        const resetAt = t.now()
        reset(t, 99)
        // After the reset's own messages (the settle of the old market comes before them).
        const seqAtReset = t.server.getLastSeq()
        tickEvery(t, stepMs, 12_000) // crosses two round boundaries
        return { trades: tradesAfter(t, seqAtReset), resetAt }
      }
      const a = run(1, 1_000, 100)
      const b = run(2, 3_700, 33)
      expect(a.trades.length).toBeGreaterThan(3_000)
      expect(relative(a.trades, a.resetAt)).toEqual(relative(b.trades, b.resetAt))
      expect(relative(run(1, 1_000, 100).trades, a.resetAt)).toEqual(relative(a.trades, a.resetAt))
      const other = (() => {
        const t = setup({ aggregation: 'full', tradesPerSec: 300 })
        t.connect(1)
        const resetAt = t.now()
        reset(t, 100)
        tickEvery(t, 100, 5_000)
        return relative(tradesAfter(t, 0), resetAt)
      })()
      expect(other.slice(0, 50)).not.toEqual(relative(a.trades, a.resetAt).slice(0, 50))
    })

    it('starts round 1 at now at 50/50 with a fresh account and keeps seq increasing', () => {
      const t = setup()
      t.connect(1)
      t.send(1, { type: 'dev', command: { kind: 'set_balance', usd: 3 } })
      t.tickFor(65_000) // round 2 by now
      t.advanceTo(t.now() + 50)
      t.posted.length = 0
      reset(t, 7)
      // The old market is settled up to now first, so trades may precede the reset messages.
      const [started, account] = t.messagesFor(1).slice(-2)
      const before = t.server.getLastSeq() - 2
      expect(started).toEqual({
        type: 'round_started',
        ts: t.now(),
        round: { id: 1, startTs: t.now(), endTs: t.now() + DEFAULT_SERVER_CONFIG.roundMs },
        price: 0.5,
        seq: before + 1,
      })
      expect(account).toMatchObject({ type: 'account', seq: before + 2, account: { balance: START_BALANCE, roundId: 1, history: [] } })
      const snapshot = t.server.getSnapshot()
      expect(snapshot.seq).toBe(before + 2)
      expect(snapshot.history).toEqual([{ time: Math.floor(t.now() / 1_000), value: 0.5 }])
      expect(snapshot.userTrades).toEqual([])
      t.tickFor(2_000)
      const seqs = t.messagesFor(1).map((m) => m.seq)
      seqs.forEach((seq, i) => expect(seq).toBe(before + 1 + i))
    })

    it('keeps trade ids increasing across a reset so clients never see a repeated id', () => {
      const t = setup({ aggregation: 'full' })
      t.connect(1)
      t.tickFor(2_000)
      const lastBefore = tradesAfter(t, 0).at(-1)?.id ?? 0
      expect(lastBefore).toBeGreaterThan(0)
      reset(t, 5)
      const settled = tradesAfter(t, 0).at(-1)?.id ?? 0
      const seq = t.server.getLastSeq()
      t.tickFor(2_000)
      expect(settled).toBeGreaterThanOrEqual(lastBefore)
      expect(tradesAfter(t, seq)[0]?.id).toBe(settled + 1)
    })

    it('settles orders queued before the reset in the old market', () => {
      const t = setup()
      t.connect(1)
      t.tickFor(500)
      t.send(1, {
        type: 'place_order',
        clientOrderId: 'before-reset',
        roundId: 1,
        side: 'yes',
        amountUsd: 10,
        expectedPrice: 0.99,
        maxSlippage: 0.1,
      })
      t.posted.length = 0
      reset(t, 5)
      const types = t.messagesFor(1).map((m) => m.type)
      expect(types.indexOf('order_result')).toBeGreaterThanOrEqual(0)
      expect(types.indexOf('order_result')).toBeLessThan(types.indexOf('round_started'))
    })

    it('keeps rate, aggregation, latency and drop settings', () => {
      const t = setup()
      t.connect(1)
      t.send(1, { type: 'dev', command: { kind: 'set_rate', tradesPerSec: 2_000 } })
      t.send(1, { type: 'dev', command: { kind: 'set_aggregation', mode: 'full' } })
      t.send(1, { type: 'dev', command: { kind: 'set_batch_interval', ms: 50 } })
      reset(t, 5)
      expect(t.server.getBatchIntervalMs()).toBe(50)
      const seq = t.server.getLastSeq()
      t.tickFor(1_000)
      const batches = t.messagesFor(1).flatMap((m) => (m.type === 'trades' && m.seq > seq ? [m] : []))
      expect(batches.every((b) => b.aggregated === 'none')).toBe(true)
      expect(batches.reduce((n, b) => n + b.items.length, 0)).toBeGreaterThan(1_500)
      t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 200 } })
      reset(t, 6)
      t.posted.length = 0
      t.deliveredAt.length = 0
      t.tickFor(300)
      const delivered = t.messagesFor(1)
      expect(delivered.length).toBeGreaterThan(0)
      delivered.forEach((m, i) => expect(t.deliveredAt[i] - m.ts).toBeGreaterThanOrEqual(200))
    })

    it('replays across the reset from the kept replay ring', () => {
      const t = setup()
      t.connect(1)
      t.tickFor(1_000)
      const from = t.server.getLastSeq() + 1
      reset(t, 5)
      t.tickFor(500)
      const live = t.messagesFor(1).filter((m) => m.seq >= from)
      t.posted.length = 0
      t.send(1, { type: 'resync', fromSeq: from })
      const replay = t.messagesFor(1)
      expect(replay).toEqual(live)
      expect(replay[0].type).toBe('round_started')
    })
  })
})
