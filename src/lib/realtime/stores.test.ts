import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountStore, selectOrder, selectQuote } from '@/lib/realtime/account-store'
import { ClockSync } from '@/lib/realtime/clock-sync'
import {
  MarketStore,
  selectPrice,
  selectRecentTrades,
  selectRound,
  selectUserTrades,
} from '@/lib/realtime/market-store'
import type { ServerMessage, Trade } from '@/lib/realtime/protocol'

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
const trades = (seq: number, items: Trade[]): ServerMessage => ({ type: 'trades', seq, ts: 0, items })

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

describe('ClockSync', () => {
  it('estimates the offset from the fastest sample', () => {
    const clock = new ClockSync(5)
    const skew = 5_000
    for (const latency of [40, 10, 25, 50]) clock.observe(1_000 + skew, 1_000 + latency)
    expect(clock.offsetMs).toBe(skew - 10)
  })

  it('returns 0 without samples', () => {
    expect(new ClockSync(5).offsetMs).toBe(0)
  })
})

describe('AccountStore', () => {
  it('tracks account, quote and only the pending order result', () => {
    const account = new AccountStore()
    account.handle(snapshot(1))
    expect(account.store.getState().account).toEqual(ACCOUNT)
    account.markPending('mine')
    account.handle({
      type: 'order_result',
      seq: 2,
      ts: 0,
      result: { status: 'rejected', clientOrderId: 'other', side: 'yes', reason: 'slippage', currentPrice: 0.5 },
    })
    expect(selectOrder(account.store.getState())).toEqual({ kind: 'pending', clientOrderId: 'mine' })
    account.handle({
      type: 'order_result',
      seq: 3,
      ts: 0,
      result: { status: 'filled', clientOrderId: 'mine', side: 'yes', shares: 10, avgPrice: 0.5, cost: 5, refund: 0 },
    })
    expect(selectOrder(account.store.getState())).toMatchObject({ kind: 'done', result: { clientOrderId: 'mine' } })
    account.handle({
      type: 'quote_result',
      seq: 4,
      ts: 0,
      quote: { status: 'unavailable', requestId: 1, side: 'yes', amountUsd: 5 },
    })
    expect(selectQuote(account.store.getState())).toMatchObject({ requestId: 1 })
  })
})
