import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AccountStore,
  type AccountStoreState,
  hasOkQuoteFor,
  type OrderRequest,
  pickQuoteFor,
  selectOrder,
  selectQuote,
  selectRoundHistory,
} from '@/lib/realtime/account-store'
import { ClockSync } from '@/lib/realtime/clock-sync'
import {
  MarketStore,
  selectPrice,
  selectClockOffset,
  selectLastResolution,
  selectRecentTrades,
  selectRound,
  selectUserTrades,
} from '@/lib/realtime/market-store'
import type { ConnectionStatus } from '@/lib/realtime/market-client'
import type { ClientMessage, ServerMessage, Trade } from '@/lib/realtime/protocol'

const ACCOUNT = {
  balance: 1_000,
  roundId: 1,
  position: { yesShares: 0, noShares: 0, spent: 0, payoutIfYes: 0, payoutIfNo: 0 },
  history: [],
}

const snapshot = (seq: number): ServerMessage => ({
  type: 'snapshot',
  seq,
  ts: 0,
  round: { id: 1, startTs: 0, endTs: 60_000 },
  price: 0.5,
  history: [{ time: 0, value: 0.5 }],
  recentTrades: [],
  userTrades: [],
  account: ACCOUNT,
})

const mock = (id: number, priceAfter: number): Trade => ({ id, ts: id, side: 'yes', shares: 1, priceAfter, source: 'mock' })
const user = (id: number, priceAfter: number): Trade => ({
  id,
  ts: id,
  side: 'no',
  shares: 2,
  priceAfter,
  source: 'user',
  clientOrderId: `o${id}`,
})
const trades = (seq: number, items: Trade[]): ServerMessage => ({ type: 'trades', seq, ts: 0, items, aggregated: 'none' })

/** Minimal client double: records sends and lets tests emit messages and status changes. */
function fakeClient() {
  const messageListeners = new Set<(message: ServerMessage) => void>()
  const statusListeners = new Set<(status: ConnectionStatus) => void>()
  const sent: ClientMessage[] = []
  return {
    sent,
    onMessage: (listener: (message: ServerMessage) => void) => {
      messageListeners.add(listener)
      return () => {
        messageListeners.delete(listener)
      }
    },
    onStatus: (listener: (status: ConnectionStatus) => void) => {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
    send: (message: ClientMessage) => {
      sent.push(message)
    },
    emit: (message: ServerMessage) => {
      for (const listener of messageListeners) listener(message)
    },
    status: (status: ConnectionStatus) => {
      for (const listener of statusListeners) listener(status)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
})
afterEach(() => {
  vi.useRealTimers()
})

function makeMarketStore() {
  const market = new MarketStore({ throttleMs: 100, recentTradesLimit: 3, clockWindow: 5, now: () => Date.now() })
  let publishes = 0
  market.store.subscribe(() => publishes++)
  return { market, publishes: () => publishes }
}

describe('MarketStore', () => {
  it('stays loading until the first snapshot', () => {
    const { market } = makeMarketStore()
    market.handle(trades(1, [mock(1, 0.6)]))
    expect(market.store.getState().phase).toBe('loading')
    market.handle(snapshot(2))
    expect(selectPrice(market.store.getState())).toBe(0.5)
  })

  it('throttles trade updates to one leading + one trailing publish per window', () => {
    const { market, publishes } = makeMarketStore()
    market.handle(snapshot(1))
    vi.advanceTimersByTime(200)
    const before = publishes()
    market.handle(trades(2, [mock(1, 0.51)]))
    for (let i = 0; i < 5; i++) market.handle(trades(3 + i, [mock(2 + i, 0.52 + i / 100)]))
    expect(publishes() - before).toBe(1)
    vi.advanceTimersByTime(100)
    expect(publishes() - before).toBe(2)
    expect(selectPrice(market.store.getState())).toBeCloseTo(0.56, 10)
  })

  it('keeps recent trades newest first and bounded', () => {
    const { market } = makeMarketStore()
    market.handle(snapshot(1))
    market.handle(trades(2, [mock(1, 0.5), mock(2, 0.5)]))
    market.handle(trades(3, [mock(3, 0.5), mock(4, 0.5)]))
    vi.advanceTimersByTime(100)
    expect(selectRecentTrades(market.store.getState()).map((t) => t.id)).toEqual([4, 3, 2])
  })

  it('publishes round changes immediately and clears user trades', () => {
    const { market, publishes } = makeMarketStore()
    market.handle(snapshot(1))
    market.handle(trades(2, [user(1, 0.48)]))
    vi.advanceTimersByTime(100)
    expect(selectUserTrades(market.store.getState())).toHaveLength(1)
    const before = publishes()
    market.handle({ type: 'round_started', seq: 3, ts: 60_000, round: { id: 2, startTs: 60_000, endTs: 120_000 }, price: 0.5 })
    expect(publishes() - before).toBe(1)
    expect(selectUserTrades(market.store.getState())).toEqual([])
    expect(selectRound(market.store.getState())).toEqual({ id: 2, startTs: 60_000, endTs: 120_000 })
  })

  it('keeps unrelated slices referentially stable', () => {
    const { market } = makeMarketStore()
    market.handle(snapshot(1))
    const round = selectRound(market.store.getState())
    market.handle(trades(2, [mock(1, 0.6)]))
    vi.advanceTimersByTime(100)
    expect(selectRound(market.store.getState())).toBe(round)
  })
})

describe('MarketStore edge cases', () => {
  it('publishNow cancels a pending trailing timer', () => {
    const { market, publishes } = makeMarketStore()
    market.handle(snapshot(1))
    vi.advanceTimersByTime(200)
    const before = publishes()
    market.handle(trades(2, [mock(1, 0.55)]))
    market.handle(trades(3, [mock(2, 0.56)]))
    expect(publishes() - before).toBe(1)
    market.handle({ type: 'round_started', seq: 4, ts: 60_000, round: { id: 2, startTs: 60_000, endTs: 120_000 }, price: 0.5 })
    expect(publishes() - before).toBe(2)
    vi.advanceTimersByTime(200)
    expect(publishes() - before).toBe(2)
    expect(selectPrice(market.store.getState())).toBe(0.5)
    expect(selectRound(market.store.getState())).toEqual({ id: 2, startTs: 60_000, endTs: 120_000 })
  })

  it('reset clears a pending trailing timer', () => {
    const { market, publishes } = makeMarketStore()
    market.handle(snapshot(1))
    vi.advanceTimersByTime(200)
    market.handle(trades(2, [mock(1, 0.55)]))
    market.handle(trades(3, [mock(2, 0.56)]))
    market.reset()
    const after = publishes()
    expect(market.store.getState().phase).toBe('loading')
    vi.advanceTimersByTime(200)
    expect(publishes()).toBe(after)
    expect(market.store.getState().phase).toBe('loading')
  })

  it('keeps unrelated slices stable across a no-user trade batch and ignores empty batches', () => {
    const { market, publishes } = makeMarketStore()
    market.handle(snapshot(1))
    vi.advanceTimersByTime(200)
    const s0 = market.store.getState()
    market.handle(trades(2, [mock(1, 0.6)]))
    const s1 = market.store.getState()
    expect(selectUserTrades(s1)).toBe(selectUserTrades(s0))
    expect(selectLastResolution(s1)).toBe(selectLastResolution(s0))
    expect(selectRound(s1)).toBe(selectRound(s0))
    const recent = selectRecentTrades(s1)
    const before = publishes()
    market.handle(trades(3, []))
    vi.advanceTimersByTime(200)
    expect(publishes()).toBe(before)
    expect(selectRecentTrades(market.store.getState())).toBe(recent)
  })

  it('snapshot respects recentTradesLimit', () => {
    const { market } = makeMarketStore()
    const base = snapshot(1)
    if (base.type !== 'snapshot') throw new Error('unreachable')
    market.handle({ ...base, recentTrades: [5, 4, 3, 2, 1].map((id) => mock(id, 0.5)) })
    expect(selectRecentTrades(market.store.getState()).map((t) => t.id)).toEqual([5, 4, 3])
  })

  it('keeps lastResolution through round_resolved -> round_started and clears user trades', () => {
    const { market } = makeMarketStore()
    market.handle(snapshot(1))
    market.handle(trades(2, [user(1, 0.48)]))
    vi.advanceTimersByTime(100)
    market.handle({ type: 'round_resolved', seq: 3, ts: 60_000, roundId: 1, outcome: 'yes', payout: 0 })
    expect(selectLastResolution(market.store.getState())).toEqual({ roundId: 1, outcome: 'yes' })
    market.handle({ type: 'round_started', seq: 4, ts: 60_000, round: { id: 2, startTs: 60_000, endTs: 120_000 }, price: 0.5 })
    expect(selectLastResolution(market.store.getState())).toEqual({ roundId: 1, outcome: 'yes' })
    expect(selectUserTrades(market.store.getState())).toEqual([])
  })

  it('detaching cancels a pending trailing publish', () => {
    const { market, publishes } = makeMarketStore()
    const client = { onMessage: () => () => {}, onStatus: () => () => {} }
    const detach = market.attach(client)
    market.handle(snapshot(1))
    vi.advanceTimersByTime(200)
    market.handle(trades(2, [mock(1, 0.55)]))
    market.handle(trades(3, [mock(2, 0.56)]))
    const before = publishes()
    detach()
    vi.advanceTimersByTime(200)
    expect(publishes()).toBe(before)
  })
})

describe('MarketStore lifecycle', () => {
  it('keeps the last resolution across a snapshot', () => {
    const { market } = makeMarketStore()
    market.handle(snapshot(1))
    market.handle({ type: 'round_resolved', seq: 2, ts: 0, roundId: 1, outcome: 'no', payout: 0 })
    market.handle(snapshot(5))
    expect(selectLastResolution(market.store.getState())).toEqual({ roundId: 1, outcome: 'no' })
  })

  it('publishes status changes immediately, even inside a throttle window', () => {
    const { market, publishes } = makeMarketStore()
    const client = fakeClient()
    market.attach(client)
    market.handle(snapshot(1))
    market.handle(trades(2, [mock(1, 0.55)]))
    const before = publishes()
    client.status('reconnecting')
    expect(publishes() - before).toBe(1)
    expect(market.store.getState().status).toBe('reconnecting')
  })

  it('goes back to loading when the client stops', () => {
    const { market } = makeMarketStore()
    const client = fakeClient()
    market.attach(client)
    client.status('live')
    market.handle(snapshot(1))
    client.status('idle')
    expect(market.store.getState()).toEqual({ phase: 'loading', status: 'idle' })
  })

  it('handles each message once when attached twice', () => {
    const { market } = makeMarketStore()
    const client = fakeClient()
    market.attach(client)
    market.attach(client)
    client.emit(snapshot(1))
    client.emit(trades(2, [user(1, 0.48)]))
    vi.advanceTimersByTime(300)
    expect(selectUserTrades(market.store.getState())).toHaveLength(1)
  })

  it('estimates the clock offset from trade batches, not only heartbeats', () => {
    const { market } = makeMarketStore()
    market.handle(snapshot(1))
    vi.advanceTimersByTime(1_000)
    // Server clock is 5 s ahead: ts = local now + 5000.
    market.handle({ type: 'trades', seq: 2, ts: 6_000, items: [mock(1, 0.5)], aggregated: 'none' })
    vi.advanceTimersByTime(300)
    expect(selectClockOffset(market.store.getState())).toBe(5_000)
  })
})

describe('ClockSync', () => {
  it('estimates the offset from the fastest sample', () => {
    const clock = new ClockSync(5)
    const skew = 5_000
    for (const latency of [40, 10, 25, 50]) clock.observe(1_000 + skew, 1_000 + latency)
    expect(clock.offsetMs).toBe(skew - 10)
  })

  it('evicts old samples beyond the window', () => {
    const clock = new ClockSync(2)
    clock.observe(1_100, 1_000) // sample 100 (best)
    clock.observe(1_020, 1_000) // sample 20
    expect(clock.offsetMs).toBe(100)
    clock.observe(1_010, 1_000) // sample 10; evicts 100
    expect(clock.offsetMs).toBe(20)
  })

  it('returns 0 without samples', () => {
    expect(new ClockSync(5).offsetMs).toBe(0)
  })
})

describe('AccountStore', () => {
  const filled = (seq: number, clientOrderId: string): ServerMessage => ({
    type: 'order_result',
    seq,
    ts: 0,
    result: { status: 'filled', clientOrderId, side: 'yes', shares: 10, avgPrice: 0.5, cost: 5, refund: 0 },
  })
  const quoteResult = (seq: number, requestId: number): ServerMessage => ({
    type: 'quote_result',
    seq,
    ts: 0,
    quote: { status: 'unavailable', requestId, side: 'yes', amountUsd: 5, maxSlippage: 0.03 },
  })
  const ORDER: OrderRequest = {
    clientOrderId: 'mine',
    roundId: 1,
    side: 'yes',
    amountUsd: 5,
    expectedPrice: 0.5,
    maxSlippage: 0.02,
  }

  function attached() {
    const account = new AccountStore()
    const client = fakeClient()
    account.attach(client)
    return { account, client }
  }

  it('keeps the history array and position object when an account update did not change them', () => {
    const { account, client } = attached()
    const row = { roundId: 1, outcome: 'yes', spent: 5, payout: 8, pnl: 3 } as const
    client.emit({ type: 'account', seq: 1, ts: 0, account: { ...ACCOUNT, history: [row] } })
    const first = account.store.getState().account
    if (first === 'loading') throw new Error('expected account')
    client.emit({
      type: 'account',
      seq: 2,
      ts: 0,
      account: { ...ACCOUNT, balance: 990, history: [{ ...row }], position: { ...ACCOUNT.position } },
    })
    const same = account.store.getState().account
    if (same === 'loading') throw new Error('expected account')
    expect(same.balance).toBe(990)
    expect(same.history).toBe(first.history)
    expect(same.position).toBe(first.position)

    client.emit({
      type: 'account',
      seq: 3,
      ts: 0,
      account: { ...ACCOUNT, history: [{ ...row, roundId: 2, pnl: -5 }, row], position: { ...ACCOUNT.position, spent: 5 } },
    })
    const changed = account.store.getState().account
    if (changed === 'loading') throw new Error('expected account')
    expect(changed.history).not.toBe(first.history)
    expect(changed.history).toHaveLength(2)
    expect(changed.position).not.toBe(first.position)
    expect(selectRoundHistory(account.store.getState())).toBe(changed.history)
  })

  it('tracks the account and resolves only the pending order', () => {
    const { account, client } = attached()
    client.emit(snapshot(1))
    expect(account.store.getState().account).toEqual(ACCOUNT)
    expect(account.placeOrder(ORDER)).toBe('sent')
    expect(client.sent).toEqual([{ type: 'place_order', ...ORDER }])
    client.emit({
      type: 'order_result',
      seq: 2,
      ts: 0,
      result: { status: 'rejected', clientOrderId: 'other', side: 'yes', reason: 'slippage', currentPrice: 0.5 },
    })
    expect(selectOrder(account.store.getState())).toEqual({ kind: 'pending', clientOrderId: 'mine' })
    client.emit(filled(3, 'mine'))
    expect(selectOrder(account.store.getState())).toMatchObject({ kind: 'done', result: { clientOrderId: 'mine' } })
  })

  it('refuses a second order while one is in flight', () => {
    const { account, client } = attached()
    account.placeOrder(ORDER)
    expect(account.placeOrder({ ...ORDER, clientOrderId: 'second' })).toBe('busy')
    expect(client.sent).toHaveLength(1)
    client.emit(filled(2, 'mine'))
    expect(account.placeOrder({ ...ORDER, clientOrderId: 'second' })).toBe('sent')
  })

  const requestIdOf = (state: AccountStoreState): number | 'none' => {
    const quote = selectQuote(state)
    return quote === 'none' ? 'none' : quote.requestId
  }

  it('sends the tolerance with the quote request and applies answers in request order', () => {
    const { account, client } = attached()
    account.requestQuote('yes', 5, 0.03)
    account.requestQuote('yes', 50, 0.05)
    expect(client.sent.map((m) => (m.type === 'quote' ? m.requestId : -1))).toEqual([1, 2])
    expect(client.sent[1]).toEqual({ type: 'quote', requestId: 2, side: 'yes', amountUsd: 50, maxSlippage: 0.05 })
    client.emit(quoteResult(1, 1))
    expect(requestIdOf(account.store.getState())).toBe(1)
    client.emit(quoteResult(2, 2))
    expect(requestIdOf(account.store.getState())).toBe(2)
  })

  it('ignores an answer older than the last applied one', () => {
    const { account, client } = attached()
    account.requestQuote('yes', 5, 0.03)
    account.requestQuote('yes', 50, 0.03)
    client.emit(quoteResult(1, 2))
    client.emit(quoteResult(2, 1)) // overtaken: arrives after the newer answer
    expect(requestIdOf(account.store.getState())).toBe(2)
    client.emit(quoteResult(3, 2)) // a repeat of the applied one is not newer either
    expect(requestIdOf(account.store.getState())).toBe(2)
  })

  it('ignores an id above the latest request (e.g. a bench probe answer)', () => {
    const { account, client } = attached()
    account.requestQuote('yes', 5, 0.03)
    client.emit(quoteResult(1, 1_000_000_000))
    expect(selectQuote(account.store.getState())).toBe('none')
    client.emit(quoteResult(2, 1))
    expect(requestIdOf(account.store.getState())).toBe(1)
  })

  it('applies an older answer while newer requests are in flight (RTT longer than the refresh interval)', () => {
    const { account, client } = attached()
    account.requestQuote('yes', 5, 0.03)
    account.requestQuote('yes', 5, 0.03)
    account.requestQuote('yes', 5, 0.03)
    client.emit(quoteResult(1, 1))
    expect(requestIdOf(account.store.getState())).toBe(1)
    client.emit(quoteResult(2, 3))
    expect(requestIdOf(account.store.getState())).toBe(3)
    client.emit(quoteResult(3, 2))
    expect(requestIdOf(account.store.getState())).toBe(3)
  })

  it('clears the quote on a new round and forgets applied ids on reset', () => {
    const { account, client } = attached()
    account.requestQuote('yes', 5, 0.03)
    client.emit(quoteResult(1, 1))
    client.emit({ type: 'round_started', seq: 2, ts: 0, round: { id: 2, startTs: 60_000, endTs: 120_000 }, price: 0.5 })
    expect(selectQuote(account.store.getState())).toBe('none')
    account.reset()
    account.requestQuote('yes', 5, 0.03) // requestId 2; a fresh store must accept its answer
    client.emit(quoteResult(3, 2))
    expect(requestIdOf(account.store.getState())).toBe(2)
  })

  it('round_started clears a done order but keeps a pending one', () => {
    const { account, client } = attached()
    const started = (seq: number): ServerMessage => ({
      type: 'round_started',
      seq,
      ts: 0,
      round: { id: 2, startTs: 60_000, endTs: 120_000 },
      price: 0.5,
    })
    account.placeOrder(ORDER)
    client.emit(started(1))
    expect(selectOrder(account.store.getState())).toEqual({ kind: 'pending', clientOrderId: 'mine' })
    client.emit(filled(2, 'mine'))
    expect(selectOrder(account.store.getState()).kind).toBe('done')
    client.emit(started(3))
    expect(selectOrder(account.store.getState())).toEqual({ kind: 'idle' })
  })

  it('dismissOrder turns done into idle and leaves pending alone', () => {
    const { account, client } = attached()
    account.placeOrder(ORDER)
    account.dismissOrder()
    expect(selectOrder(account.store.getState()).kind).toBe('pending')
    client.emit(filled(1, 'mine'))
    account.dismissOrder()
    expect(selectOrder(account.store.getState())).toEqual({ kind: 'idle' })
  })

  it('selectRoundHistory returns a shared empty list while loading', () => {
    const { account } = attached()
    const first = selectRoundHistory(account.store.getState())
    expect(first).toEqual([])
    expect(selectRoundHistory(account.store.getState())).toBe(first)
  })

  it('resets when the client stops and refuses to send while detached', () => {
    const { account, client } = attached()
    client.emit(snapshot(1))
    account.placeOrder(ORDER)
    client.status('idle')
    expect(account.store.getState()).toEqual({ account: 'loading', order: { kind: 'idle' }, quote: 'none' })
    expect(() => new AccountStore().placeOrder(ORDER)).toThrow('not attached')
  })
})

describe('pickQuoteFor / hasOkQuoteFor', () => {
  const ok = {
    status: 'ok',
    requestId: 1,
    side: 'yes',
    amountUsd: 10,
    shares: 20,
    avgPrice: 0.5,
    cost: 10,
    potentialPayout: 20,
    potentialProfit: 10,
    clipped: false,
    maxSlippage: 0.03,
    worstAvgPrice: 0.53,
    minShares: 10 / 0.53,
  } as const
  const unavailable = { status: 'unavailable', requestId: 2, side: 'yes', amountUsd: 10, maxSlippage: 0.03 } as const
  const withQuote = (quote: AccountStoreState['quote']): AccountStoreState => ({ account: 'loading', order: { kind: 'idle' }, quote })

  it('returns the quote for matching side and amount', () => {
    expect(pickQuoteFor(withQuote(ok), 'yes', 10, 0.03)).toBe(ok)
    expect(hasOkQuoteFor(withQuote(ok), 'yes', 10, 0.03)).toBe(true)
  })

  it('ignores other side, amount or tolerance', () => {
    expect(pickQuoteFor(withQuote(ok), 'yes', 10, 0.05)).toBe('none')
    expect(pickQuoteFor(withQuote(ok), 'no', 10, 0.03)).toBe('none')
    expect(pickQuoteFor(withQuote(ok), 'yes', 11, 0.03)).toBe('none')
    expect(hasOkQuoteFor(withQuote(ok), 'no', 10, 0.03)).toBe(false)
  })

  it("is 'none' when unavailable, absent or the amount is invalid", () => {
    expect(pickQuoteFor(withQuote('none'), 'yes', 10, 0.03)).toBe('none')
    expect(pickQuoteFor(withQuote(ok), 'yes', 'invalid', 0.03)).toBe('none')
    expect(pickQuoteFor(withQuote(unavailable), 'yes', 10, 0.03)).toBe(unavailable)
    expect(hasOkQuoteFor(withQuote(unavailable), 'yes', 10, 0.03)).toBe(false)
  })
})
