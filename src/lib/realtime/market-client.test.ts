import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketClient } from '@/lib/realtime/market-client'
import {
  type ClientMessage,
  parseClientMessage,
  type PlaceOrder,
  type ServerMessage,
} from '@/lib/realtime/protocol'
import type { SocketFactory, SocketHandlers } from '@/lib/realtime/socket'

type FakeSocket = { handlers: SocketHandlers; sent: ClientMessage[]; closed: boolean }

function fakeSockets() {
  const sockets: FakeSocket[] = []
  const factory: SocketFactory = (handlers) => {
    const sent: ClientMessage[] = []
    const entry: FakeSocket = { handlers, sent, closed: false }
    sockets.push(entry)
    return {
      send: (data) => {
        const parsed = parseClientMessage(data)
        if (parsed !== 'invalid') sent.push(parsed)
      },
      close: () => {
        entry.closed = true
      },
    }
  }
  const latest = (): FakeSocket => {
    const socket = sockets.at(-1)
    if (socket === undefined) throw new Error('no socket created')
    return socket
  }
  return { sockets, factory, latest }
}

const json = (message: ServerMessage): string => JSON.stringify(message)
const heartbeat = (seq: number): string => json({ type: 'heartbeat', ts: seq, seq })
const snapshot = (seq: number): string =>
  json({
    type: 'snapshot',
    seq,
    ts: 0,
    round: { id: 1, startTs: 0, endTs: 60_000 },
    price: 0.5,
    history: [],
    recentTrades: [],
    userTrades: [],
    account: {
      balance: 1_000,
      roundId: 1,
      position: { yesShares: 0, noShares: 0, spent: 0, payoutIfYes: 0, payoutIfNo: 0 },
      history: [],
    },
  })
const orderResult = (seq: number, clientOrderId: string): string =>
  json({
    type: 'order_result',
    seq,
    ts: 0,
    result: { status: 'rejected', clientOrderId, side: 'yes', reason: 'slippage', currentPrice: 0.5 },
  })

const ORDER: PlaceOrder = {
  type: 'place_order',
  clientOrderId: 'c1',
  roundId: 1,
  side: 'yes',
  amountUsd: 10,
  expectedPrice: 0.5,
  maxSlippage: 0.02,
}

function setup() {
  const fake = fakeSockets()
  const client = new MarketClient({
    createSocket: fake.factory,
    random: () => 1,
    backoffBaseMs: 100,
    backoffMaxMs: 1_000,
    resyncTimeoutMs: 500,
  })
  const seen: number[] = []
  client.onMessage((message) => seen.push(message.seq))
  const goLive = (seq: number) => {
    client.start()
    fake.latest().handlers.onOpen()
    fake.latest().handlers.onMessage(snapshot(seq))
  }
  return { fake, client, seen, goLive }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MarketClient', () => {
  it('connects and asks for a snapshot on open', () => {
    const { fake, client } = setup()
    client.start()
    expect(client.getStatus()).toBe('connecting')
    fake.latest().handlers.onOpen()
    expect(client.getStatus()).toBe('resyncing')
    expect(fake.latest().sent).toEqual([{ type: 'resync', fromSeq: 1 }])
  })

  it('goes live on snapshot, delivers in order and drops duplicates', () => {
    const { fake, client, seen, goLive } = setup()
    goLive(10)
    expect(client.getStatus()).toBe('live')
    const socket = fake.latest()
    socket.handlers.onMessage(heartbeat(11))
    socket.handlers.onMessage(heartbeat(11))
    socket.handlers.onMessage(heartbeat(12))
    expect(seen).toEqual([10, 11, 12])
    expect(client.stats.duplicates).toBe(1)
    expect(client.getLastSeq()).toBe(12)
  })

  it('buffers messages that arrive before the snapshot', () => {
    const { fake, client, seen } = setup()
    client.start()
    const socket = fake.latest()
    socket.handlers.onOpen()
    socket.handlers.onMessage(heartbeat(12))
    socket.handlers.onMessage(heartbeat(11))
    socket.handlers.onMessage(snapshot(10))
    expect(seen).toEqual([10, 11, 12])
    expect(client.stats.gaps).toBe(0)
    expect(client.getStatus()).toBe('live')
  })

  it('detects a gap, resyncs from the first missing seq and applies in order', () => {
    const { fake, client, seen, goLive } = setup()
    goLive(10)
    const socket = fake.latest()
    socket.handlers.onMessage(heartbeat(13))
    expect(seen).toEqual([10])
    expect(socket.sent.at(-1)).toEqual({ type: 'resync', fromSeq: 11 })
    expect(client.stats.gaps).toBe(1)
    socket.handlers.onMessage(heartbeat(11))
    socket.handlers.onMessage(heartbeat(12))
    expect(seen).toEqual([10, 11, 12, 13])
    expect(client.getStatus()).toBe('live')
  })

  it('resends resync if the gap is not filled in time', () => {
    const { fake, goLive } = setup()
    goLive(10)
    const socket = fake.latest()
    socket.handlers.onMessage(heartbeat(12))
    expect(socket.sent.filter((m) => m.type === 'resync')).toHaveLength(2)
    vi.advanceTimersByTime(500)
    expect(socket.sent.filter((m) => m.type === 'resync')).toHaveLength(3)
    expect(socket.sent.at(-1)).toEqual({ type: 'resync', fromSeq: 11 })
  })

  it('reconnects with backoff and resyncs from lastSeq + 1', () => {
    const { fake, client, goLive } = setup()
    goLive(10)
    fake.latest().handlers.onClose()
    expect(client.getStatus()).toBe('reconnecting')
    vi.advanceTimersByTime(99)
    expect(fake.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(fake.sockets).toHaveLength(2)
    fake.latest().handlers.onOpen()
    expect(fake.latest().sent).toEqual([{ type: 'resync', fromSeq: 11 }])
    expect(client.stats.reconnects).toBe(1)
  })

  it('counts reconnects on re-open, not on close; handshake resyncs are not counted', () => {
    const { fake, client, goLive } = setup()
    goLive(10)
    expect(client.stats.resyncs).toBe(0)
    expect(client.stats.reconnects).toBe(0)
    fake.latest().handlers.onMessage(heartbeat(12))
    expect(client.stats.resyncs).toBe(1)
    fake.latest().handlers.onClose()
    expect(client.stats.reconnects).toBe(0)
    vi.advanceTimersByTime(100)
    fake.latest().handlers.onOpen()
    expect(client.stats.reconnects).toBe(1)
    expect(client.stats.resyncs).toBe(1)
  })

  it('backs off resync retries exponentially up to 8x the base timeout', () => {
    const { fake, goLive } = setup()
    goLive(10)
    const socket = fake.latest()
    const resyncs = () => socket.sent.filter((m) => m.type === 'resync').length
    socket.handlers.onMessage(heartbeat(12))
    expect(resyncs()).toBe(2)
    vi.advanceTimersByTime(499)
    expect(resyncs()).toBe(2)
    vi.advanceTimersByTime(1)
    expect(resyncs()).toBe(3)
    vi.advanceTimersByTime(999)
    expect(resyncs()).toBe(3)
    vi.advanceTimersByTime(1)
    expect(resyncs()).toBe(4)
    vi.advanceTimersByTime(1_999)
    expect(resyncs()).toBe(4)
    vi.advanceTimersByTime(1)
    expect(resyncs()).toBe(5)
    vi.advanceTimersByTime(3_999)
    expect(resyncs()).toBe(5)
    vi.advanceTimersByTime(1)
    expect(resyncs()).toBe(6)
    // Capped at 8 x 500 = 4000 ms from here on.
    vi.advanceTimersByTime(4_000)
    expect(resyncs()).toBe(7)
  })

  it('requestSnapshot while reconnecting asks for fromSeq 0 after reopen, then clears on snapshot', () => {
    const { fake, client, seen, goLive } = setup()
    goLive(10)
    fake.latest().handlers.onClose()
    client.requestSnapshot()
    vi.advanceTimersByTime(100)
    fake.latest().handlers.onOpen()
    expect(fake.latest().sent[0]).toEqual({ type: 'resync', fromSeq: 0 })
    vi.advanceTimersByTime(500)
    expect(fake.latest().sent.at(-1)).toEqual({ type: 'resync', fromSeq: 0 })
    fake.latest().handlers.onMessage(snapshot(10))
    expect(seen).toEqual([10, 10])
    expect(client.getStatus()).toBe('live')
    fake.latest().handlers.onClose()
    vi.advanceTimersByTime(100)
    fake.latest().handlers.onOpen()
    expect(fake.latest().sent).toEqual([{ type: 'resync', fromSeq: 11 }])
  })

  it('grows the backoff exponentially up to the cap', () => {
    const { fake, client } = setup()
    client.start()
    const delays = [100, 200, 400, 800, 1_000, 1_000]
    for (const delay of delays) {
      const count = fake.sockets.length
      fake.latest().handlers.onClose()
      vi.advanceTimersByTime(delay - 1)
      expect(fake.sockets).toHaveLength(count)
      vi.advanceTimersByTime(1)
      expect(fake.sockets).toHaveLength(count + 1)
    }
  })

  it('holds orders until live and resends unresolved orders after reconnect', () => {
    const { fake, client } = setup()
    client.start()
    fake.latest().handlers.onOpen()
    client.send(ORDER)
    expect(fake.latest().sent.some((m) => m.type === 'place_order')).toBe(false)
    fake.latest().handlers.onMessage(snapshot(1))
    expect(fake.latest().sent.filter((m) => m.type === 'place_order')).toHaveLength(1)

    fake.latest().handlers.onClose()
    vi.advanceTimersByTime(100)
    fake.latest().handlers.onOpen()
    fake.latest().handlers.onMessage(heartbeat(2))
    expect(fake.latest().sent.filter((m) => m.type === 'place_order')).toHaveLength(1)

    fake.latest().handlers.onMessage(orderResult(3, 'c1'))
    fake.latest().handlers.onClose()
    vi.advanceTimersByTime(100)
    fake.latest().handlers.onOpen()
    fake.latest().handlers.onMessage(heartbeat(4))
    expect(fake.latest().sent.some((m) => m.type === 'place_order')).toBe(false)
  })

  it('stop resets state and never reconnects', () => {
    const { fake, client, goLive } = setup()
    goLive(10)
    client.stop()
    expect(client.getStatus()).toBe('idle')
    expect(fake.latest().closed).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(fake.sockets).toHaveLength(1)
    client.start()
    fake.latest().handlers.onOpen()
    expect(fake.latest().sent).toEqual([{ type: 'resync', fromSeq: 1 }])
  })

  it('ignores events from a stale socket', () => {
    const { fake, client, seen } = setup()
    client.start()
    const first = fake.latest()
    first.handlers.onClose()
    vi.advanceTimersByTime(100)
    first.handlers.onOpen()
    first.handlers.onMessage(snapshot(5))
    expect(seen).toEqual([])
    expect(client.getStatus()).toBe('reconnecting')
  })

  it('requestSnapshot asks for fromSeq 0', () => {
    const { fake, client, goLive } = setup()
    goLive(3)
    client.requestSnapshot()
    expect(fake.latest().sent.at(-1)).toEqual({ type: 'resync', fromSeq: 0 })
  })
})
