import { describe, expect, it } from 'vitest'
import type { WorkerToMain } from '@/lib/realtime/bridge'
import { type ClientMessage, parseServerMessage, type ServerMessage } from '@/lib/realtime/protocol'
import { DEFAULT_SERVER_CONFIG, MockServer, type ServerConfig } from '@/server/mock-server'
import { createRng } from '@/server/rng'

function setup(overrides: Partial<ServerConfig> = {}) {
  let now = 0
  const posted: WorkerToMain[] = []
  const scheduled: { fn: () => void; ms: number }[] = []
  const server = new MockServer(
    {
      post: (message) => posted.push(message),
      now: () => now,
      rng: createRng(42),
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
    },
    { ...DEFAULT_SERVER_CONFIG, ...overrides },
  )
  const messagesFor = (connId: number): ServerMessage[] =>
    posted.flatMap((p) => {
      if (p.kind !== 'data' || p.connId !== connId) return []
      const parsed = parseServerMessage(p.data)
      return parsed === 'invalid' ? [] : [parsed]
    })
  return {
    server,
    posted,
    scheduled,
    messagesFor,
    tickFor(ms: number) {
      for (let t = 0; t < ms; t += 100) {
        now += 100
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
      maxSlippage: 0.5,
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
    const delivered = t.messagesFor(1).length
    expect(delivered).toBeLessThan(t.server.getLastSeq())
  })

  it('delays delivery by the configured latency', () => {
    const t = setup()
    t.connect(1)
    t.send(1, { type: 'dev', command: { kind: 'set_latency', ms: 200 } })
    t.posted.length = 0
    t.tickFor(300)
    expect(t.messagesFor(1)).toEqual([])
    expect(t.scheduled.length).toBeGreaterThan(0)
    expect(t.scheduled.every((s) => s.ms === 200)).toBe(true)
    for (const s of t.scheduled) s.fn()
    expect(t.messagesFor(1).length).toBe(t.scheduled.length)
  })

  it('ignores data for unknown connections and garbage payloads', () => {
    const t = setup()
    t.server.onBridgeMessage({ kind: 'data', connId: 9, data: JSON.stringify({ type: 'resync', fromSeq: 1 }) })
    t.connect(1)
    t.server.onBridgeMessage({ kind: 'data', connId: 1, data: 'garbage' })
    expect(t.posted).toEqual([{ kind: 'open', connId: 1 }])
  })

  it('publishes heartbeats with seq', () => {
    const t = setup()
    t.connect(1)
    t.server.heartbeat()
    expect(t.messagesFor(1).at(-1)).toMatchObject({ type: 'heartbeat', seq: t.server.getLastSeq() })
  })
})
