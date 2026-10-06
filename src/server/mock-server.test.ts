import { describe, expect, it } from 'vitest'
import type { WorkerToMain } from '@/lib/realtime/bridge'
import { type ClientMessage, parseServerMessage, type ServerMessage } from '@/lib/realtime/protocol'
import { DEFAULT_SERVER_CONFIG, MockServer, type ServerConfig } from '@/server/mock-server'
import { createRng } from '@/server/rng'

type Timer = { fn: () => void; due: number; order: number }

/** `timerJitterMs` makes timers fire late, like real `setTimeout` under load. */
function setup(overrides: Partial<ServerConfig> = {}, timerJitterMs = 0) {
  let now = 0
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
      rng: createRng(42),
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
    t.send(1, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 25 })
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
})
