import { describe, expect, it } from 'vitest'
import type { PlaceOrder, ServerPayload, Side } from '@/lib/realtime/protocol'
import { type EngineConfig, MarketEngine } from '@/server/market-engine'
import type { MockTraderModel } from '@/server/mock-traders'
import type { Resolver } from '@/server/resolvers/types'
import { createRng } from '@/server/rng'

const CONFIG: EngineConfig = {
  liquidity: 3_000,
  priceBound: 0.85,
  startBalance: 1_000,
  maxSlippage: 0.1,
  roundMs: 60_000,
  recentTradesLimit: 20,
  roundHistoryLimit: 20,
  orderResultCacheLimit: 100,
}

const ALWAYS_YES: MockTraderModel = { pickSide: () => 'yes' }
const YES_WINS: Resolver = { onRoundStart() {}, resolve: () => 'yes' }
const NO_WINS: Resolver = { onRoundStart() {}, resolve: () => 'no' }

function makeEngine(overrides: Partial<EngineConfig> = {}, resolver: Resolver = YES_WINS): MarketEngine {
  return new MarketEngine({ ...CONFIG, ...overrides }, { rng: createRng(1), resolver, traders: ALWAYS_YES }, 0)
}

function order(overrides: Partial<PlaceOrder> = {}): PlaceOrder {
  return {
    type: 'place_order',
    clientOrderId: 'o1',
    roundId: 1,
    side: 'yes',
    amountUsd: 100,
    expectedPrice: 0.6,
    maxSlippage: 0.03,
    ...overrides,
  }
}

function ofType<T extends ServerPayload['type']>(
  out: readonly ServerPayload[],
  type: T,
): Extract<ServerPayload, { type: T }>[] {
  return out.filter((p): p is Extract<ServerPayload, { type: T }> => p.type === type)
}

describe('MarketEngine.setBalance', () => {
  it('overwrites the balance, ignoring negative and non-finite values', () => {
    const engine = makeEngine()
    engine.setBalance(40)
    expect(engine.getAccount().balance).toBe(40)
    engine.setBalance(-1)
    engine.setBalance(Number.NaN)
    expect(engine.getAccount().balance).toBe(40)
    engine.setBalance(0)
    expect(engine.getAccount().balance).toBe(0)
  })

  it('lets an order go through after a top-up', () => {
    const engine = makeEngine()
    engine.setBalance(0)
    engine.enqueueOrder(1, order())
    expect(ofType(engine.advance(2), 'order_result')[0].result).toMatchObject({ status: 'rejected', reason: 'insufficient_balance' })
    engine.setBalance(1_000)
    engine.enqueueOrder(3, order({ clientOrderId: 'o2' }))
    expect(ofType(engine.advance(4), 'order_result')[0].result.status).toBe('filled')
  })
})

describe('MarketEngine', () => {
  it('opens round 1 at 50% with a single start point', () => {
    const engine = makeEngine()
    const snap = engine.snapshot(0)
    expect(snap.round).toEqual({ id: 1, startTs: 0, endTs: 60_000 })
    expect(snap.price).toBe(0.5)
    expect(snap.history).toEqual([{ time: 0, value: 0.5 }])
    expect(snap.account.balance).toBe(1_000)
  })

  it('batches due mock trades into one trades payload ordered by ts', () => {
    const engine = makeEngine()
    engine.enqueueMock(300, 10)
    engine.enqueueMock(100, 10)
    engine.enqueueMock(200, 10)
    engine.enqueueMock(900, 10) // not due yet
    const out = engine.advance(500)
    const [batch] = ofType(out, 'trades')
    expect(out).toHaveLength(1)
    expect(batch.items.map((t) => t.ts)).toEqual([100, 200, 300])
    expect(batch.items[2].priceAfter).toBeGreaterThan(batch.items[0].priceAfter)
  })

  it('collapses history to the last price per second', () => {
    const engine = makeEngine()
    engine.enqueueMock(1_100, 10)
    engine.enqueueMock(1_500, 10)
    engine.enqueueMock(2_100, 10)
    const [batch] = ofType(engine.advance(3_000), 'trades')
    expect(engine.snapshot(3_000).history).toEqual([
      { time: 0, value: 0.5 },
      { time: 1, value: batch.items[1].priceAfter },
      { time: 2, value: batch.items[2].priceAfter },
    ])
  })

  it('fills a user order: trade, then order_result, then account', () => {
    const engine = makeEngine()
    engine.enqueueOrder(1_000, order())
    const out = engine.advance(1_000)
    expect(out.map((p) => p.type)).toEqual(['trades', 'order_result', 'account'])
    const [{ result }] = ofType(out, 'order_result')
    if (result.status !== 'filled') throw new Error(`expected filled, got ${result.status}`)
    expect(result.cost).toBe(100)
    expect(result.refund).toBe(0)
    const [{ account }] = ofType(out, 'account')
    expect(account.balance).toBe(900)
    expect(account.position.yesShares).toBeCloseTo(result.shares, 9)
    expect(account.position.payoutIfYes).toBeCloseTo(result.shares, 9)
    const [batch] = ofType(out, 'trades')
    expect(batch.items[0]).toMatchObject({ source: 'user', clientOrderId: 'o1', side: 'yes' })
  })

  it('earlier mock trade executes first even if enqueued later', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 100 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    engine.enqueueOrder(1_000, order({ expectedPrice: quote.avgPrice, maxSlippage: 0 }))
    engine.enqueueMock(999, 200) // arrives at the server later, but happened 1 ms earlier
    const out = engine.advance(1_000)
    const [batch] = ofType(out, 'trades')
    expect(batch.items.map((t) => t.source)).toEqual(['mock'])
    const [{ result }] = ofType(out, 'order_result')
    expect(result).toMatchObject({ status: 'rejected', reason: 'slippage' })
    if (result.status !== 'rejected') throw new Error('expected rejection')
    expect(result.currentPrice).toBeCloseTo(engine.getPrice(), 12)
  })

  it('fills when the price moved by less than the absolute tolerance', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 100 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    engine.enqueueOrder(1_000, order({ expectedPrice: quote.avgPrice, maxSlippage: 0.03 }))
    engine.enqueueMock(999, 150) // moves the average by roughly 1-2 cents
    const [{ result }] = ofType(engine.advance(1_000), 'order_result')
    if (result.status !== 'filled') throw new Error(`expected fill, got ${result.status}`)
    const move = result.avgPrice - quote.avgPrice
    expect(move).toBeGreaterThan(0.006)
    expect(move).toBeLessThanOrEqual(0.03)
  })

  it('tolerance is absolute, not relative: fills near 20c where 3% of the price would be 0.6c', () => {
    const mockSide: { current: Side } = { current: 'no' }
    const engine = new MarketEngine(
      CONFIG,
      { rng: createRng(1), resolver: YES_WINS, traders: { pickSide: () => mockSide.current } },
      0,
    )
    engine.enqueueMock(10, 4_000) // NO flow drives YES down to roughly 20c
    engine.advance(10)
    expect(engine.getPrice()).toBeLessThan(0.25)
    mockSide.current = 'yes'
    const quote = engine.quote(20, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 100 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    expect(quote.avgPrice).toBeLessThan(0.25)
    engine.enqueueOrder(1_000, order({ expectedPrice: quote.avgPrice, maxSlippage: 0.03 }))
    engine.enqueueMock(999, 250) // YES flow lifts the average by roughly 1-2 cents
    const [{ result }] = ofType(engine.advance(1_000), 'order_result')
    if (result.status !== 'filled') throw new Error(`expected fill, got ${result.status}`)
    const move = result.avgPrice - quote.avgPrice
    expect(move).toBeGreaterThan(quote.avgPrice * 0.03) // a relative 3% tolerance would reject
    expect(move).toBeGreaterThan(0.006)
    expect(move).toBeLessThanOrEqual(0.03)
  })

  it('fills at exactly expected + tolerance and accepts the maxSlippage cap', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 100 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    // The server fills at the quoted average, so expectedPrice = avg - tolerance sits exactly on the boundary.
    engine.enqueueOrder(10, order({ clientOrderId: 'edge', expectedPrice: quote.avgPrice - 0.03, maxSlippage: 0.03 }))
    engine.enqueueOrder(11, order({ clientOrderId: 'cap', amountUsd: 10, expectedPrice: 0.9, maxSlippage: 0.1 }))
    const results = ofType(engine.advance(11), 'order_result').map((r) => r.result.status)
    expect(results).toEqual(['filled', 'filled'])
  })

  it('rejects with slippage when the price moved by more than the tolerance', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 100 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    engine.enqueueOrder(1_000, order({ expectedPrice: quote.avgPrice, maxSlippage: 0.01 }))
    engine.enqueueMock(999, 400)
    const [{ result }] = ofType(engine.advance(1_000), 'order_result')
    expect(result).toMatchObject({ status: 'rejected', reason: 'slippage' })
  })

  it.each([0.11, -0.01, Number.NaN])('rejects maxSlippage %s as invalid', (maxSlippage) => {
    const engine = makeEngine()
    engine.enqueueOrder(10, order({ maxSlippage }))
    const [{ result }] = ofType(engine.advance(10), 'order_result')
    expect(result).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('a later mock trade executes after the user order', () => {
    const engine = makeEngine()
    engine.enqueueMock(1_001, 200)
    engine.enqueueOrder(1_000, order())
    const [batch] = ofType(engine.advance(1_001), 'trades')
    expect(batch.items.map((t) => t.source)).toEqual(['user', 'mock'])
  })

  it('a quote matches the subsequent fill and does not move the price', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 7, side: 'no', amountUsd: 50 }).quote
    expect(engine.getPrice()).toBe(0.5)
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    expect(quote.potentialPayout).toBeCloseTo(quote.shares, 12)
    expect(quote.potentialProfit).toBeCloseTo(quote.shares - 50, 9)
    engine.enqueueOrder(10, order({ side: 'no', amountUsd: 50, expectedPrice: quote.avgPrice, maxSlippage: 0 }))
    const [{ result }] = ofType(engine.advance(10), 'order_result')
    if (result.status === 'rejected') throw new Error(result.reason)
    expect(result.shares).toBeCloseTo(quote.shares, 9)
  })

  it('is idempotent by clientOrderId', () => {
    const engine = makeEngine()
    engine.enqueueOrder(10, order())
    engine.enqueueOrder(20, order())
    const out = engine.advance(20)
    expect(ofType(out, 'trades')[0].items).toHaveLength(1)
    const results = ofType(out, 'order_result')
    expect(results).toHaveLength(2)
    expect(results[1].result).toEqual(results[0].result)
    expect(engine.snapshot(20).account.balance).toBe(900)
  })

  it('rejects invalid amounts and insufficient balance without moving the price', () => {
    const engine = makeEngine()
    engine.enqueueOrder(1, order({ clientOrderId: 'neg', amountUsd: -5 }))
    engine.enqueueOrder(2, order({ clientOrderId: 'nan', amountUsd: Number.NaN }))
    engine.enqueueOrder(3, order({ clientOrderId: 'big', amountUsd: 2_000 }))
    const reasons = ofType(engine.advance(3), 'order_result').map((p) =>
      p.result.status === 'rejected' ? p.result.reason : p.result.status,
    )
    expect(reasons).toEqual(['invalid', 'invalid', 'insufficient_balance'])
    expect(engine.getPrice()).toBe(0.5)
  })

  it('partially fills up to the bound and refunds the rest', () => {
    const engine = makeEngine({ startBalance: 10_000 })
    engine.enqueueOrder(5, order({ amountUsd: 5_000, expectedPrice: 0.9 }))
    const out = engine.advance(5)
    const [{ result }] = ofType(out, 'order_result')
    if (result.status !== 'partial') throw new Error(`expected partial, got ${result.status}`)
    expect(result.refund).toBeCloseTo(5_000 - result.cost, 9)
    expect(engine.getPrice()).toBeCloseTo(0.85, 9)
    expect(ofType(out, 'account')[0].account.balance).toBeCloseTo(10_000 - result.cost, 9)
  })

  it('never lets mock trades push the price past the bound', () => {
    const engine = makeEngine()
    for (let i = 1; i <= 50; i++) engine.enqueueMock(i, 5_000)
    const [batch] = ofType(engine.advance(100), 'trades')
    expect(batch.items.length).toBeLessThan(50)
    expect(engine.getPrice()).toBeLessThanOrEqual(0.85 + 1e-9)
    expect(engine.getPrice()).toBeGreaterThan(0.85 - 1e-6)
  })

  it('rejects an order for a round that already ended', () => {
    const engine = makeEngine()
    engine.enqueueOrder(60_000, order())
    const out = engine.advance(60_000)
    expect(out.map((p) => p.type)).toEqual(['round_resolved', 'round_started', 'account', 'order_result'])
    expect(ofType(out, 'order_result')[0].result).toMatchObject({ status: 'rejected', reason: 'round_closed' })
  })

  it('pays $1 per winning share at resolution and resets the round', () => {
    const engine = makeEngine()
    engine.enqueueOrder(1_000, order())
    const first = engine.advance(1_000)
    const [{ result }] = ofType(first, 'order_result')
    if (result.status !== 'filled') throw new Error('expected fill')
    const out = engine.advance(60_000)
    const [resolved] = ofType(out, 'round_resolved')
    expect(resolved).toMatchObject({ roundId: 1, outcome: 'yes', ts: 60_000 })
    expect(resolved.payout).toBeCloseTo(result.shares, 9)
    const [{ account }] = ofType(out, 'account')
    expect(account.balance).toBeCloseTo(900 + result.shares, 9)
    expect(account.position.yesShares).toBe(0)
    expect(account.roundId).toBe(2)
    expect(account.history[0]).toMatchObject({ roundId: 1, outcome: 'yes', spent: 100 })
    expect(account.history[0].pnl).toBeCloseTo(result.shares - 100, 9)
    const [started] = ofType(out, 'round_started')
    expect(started.round).toEqual({ id: 2, startTs: 60_000, endTs: 120_000 })
    expect(started.price).toBe(0.5)
    expect(engine.snapshot(60_000).history).toEqual([{ time: 60, value: 0.5 }])
    expect(engine.snapshot(60_000).userTrades).toEqual([])
  })

  it('pays the NO side when NO wins and nothing for losing YES shares', () => {
    const engine = makeEngine({}, NO_WINS)
    engine.enqueueOrder(1_000, order({ clientOrderId: 'y', side: 'yes', amountUsd: 100 }))
    engine.enqueueOrder(2_000, order({ clientOrderId: 'n', side: 'no', amountUsd: 50, expectedPrice: 0.6 }))
    const fills = ofType(engine.advance(2_000), 'order_result').map((p) => p.result)
    const noFill = fills.find((r) => r.clientOrderId === 'n')
    if (noFill?.status !== 'filled') throw new Error('expected NO fill')
    const out = engine.advance(60_000)
    const [resolved] = ofType(out, 'round_resolved')
    expect(resolved.outcome).toBe('no')
    expect(resolved.payout).toBeCloseTo(noFill.shares, 9)
    const [{ account }] = ofType(out, 'account')
    expect(account.balance).toBeCloseTo(850 + noFill.shares, 9)
    expect(account.history[0].pnl).toBeCloseTo(noFill.shares - 150, 9)
  })

  it('quotes a clipped fill near the bound', () => {
    const engine = makeEngine()
    const quote = engine.quote(0, { type: 'quote', requestId: 1, side: 'yes', amountUsd: 5_000 }).quote
    if (quote.status !== 'ok') throw new Error('quote unavailable')
    expect(quote.clipped).toBe(true)
    expect(quote.cost).toBeLessThan(5_000)
    expect(engine.quote(0, { type: 'quote', requestId: 2, side: 'yes', amountUsd: 50 }).quote).toMatchObject({
      clipped: false,
    })
  })

  it('forgets the oldest clientOrderId once the idempotency cache is full', () => {
    const engine = makeEngine({ orderResultCacheLimit: 2, startBalance: 10_000 })
    for (const id of ['a', 'b', 'c']) engine.enqueueOrder(10, order({ clientOrderId: id, amountUsd: 1 }))
    engine.advance(10)
    engine.enqueueOrder(20, order({ clientOrderId: 'c', amountUsd: 1 })) // still cached → no new trade
    engine.enqueueOrder(20, order({ clientOrderId: 'a', amountUsd: 1 })) // evicted → executes again
    const [batch] = ofType(engine.advance(20), 'trades')
    expect(batch.items.map((t) => (t.source === 'user' ? t.clientOrderId : t.source))).toEqual(['a'])
  })

  it('rolls over multiple missed rounds', () => {
    const engine = makeEngine()
    const out = engine.advance(185_000)
    expect(ofType(out, 'round_started').map((p) => p.round.id)).toEqual([2, 3, 4])
    expect(engine.getRound().id).toBe(4)
  })

  it('puts events at the boundary into the new round', () => {
    const engine = makeEngine()
    engine.enqueueMock(59_999, 10)
    engine.enqueueMock(60_000, 10)
    const out = engine.advance(60_500)
    expect(out.map((p) => p.type)).toEqual(['trades', 'round_resolved', 'round_started', 'account', 'trades'])
    const [first, second] = ofType(out, 'trades')
    expect(second.items[0].ts).toBe(60_000)
    expect(second.items[0].priceAfter).toBeCloseTo(first.items[0].priceAfter, 12)
  })

  it('never lets the YES price fall below 1 - bound when mock traders always buy NO', () => {
    const engine = new MarketEngine(
      CONFIG,
      { rng: createRng(1), resolver: YES_WINS, traders: { pickSide: () => 'no' } },
      0,
    )
    let minPrice = 1
    for (let i = 1; i <= 50; i++) {
      engine.enqueueMock(i, 5_000)
      engine.advance(i)
      minPrice = Math.min(minPrice, engine.getPrice())
    }
    expect(minPrice).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(minPrice).toBeLessThan(0.15 + 1e-6)
  })

  it('keeps recent trades newest first and bounded', () => {
    const engine = makeEngine({ recentTradesLimit: 3 })
    for (let i = 1; i <= 5; i++) engine.enqueueMock(i * 10, 10)
    engine.advance(100)
    expect(engine.snapshot(100).recentTrades.map((t) => t.ts)).toEqual([50, 40, 30])
  })
})
