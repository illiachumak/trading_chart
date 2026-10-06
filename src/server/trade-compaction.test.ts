import { describe, expect, it } from 'vitest'
import type { Trade } from '@/lib/realtime/protocol'
import { compactTrades } from '@/server/trade-compaction'

const mock = (id: number, ts: number, shares = 10): Trade => ({
  id,
  ts,
  side: 'yes',
  shares,
  priceAfter: 0.5 + id / 10_000,
  source: 'mock',
})
const user = (id: number, ts: number): Trade => ({ ...mock(id, ts), source: 'user', clientOrderId: `order-${id}` })

/** `count` mock trades spread evenly over [fromTs, toTs). */
function spread(count: number, fromTs: number, toTs: number, firstId = 1): Trade[] {
  const step = (toTs - fromTs) / count
  return Array.from({ length: count }, (_, i) => mock(firstId + i, Math.floor(fromTs + i * step)))
}

describe('compactTrades', () => {
  it('keeps everything when the batch is no larger than the feed limit', () => {
    const items = spread(12, 1_000, 1_100)
    expect(compactTrades(items, 12)).toEqual({ items, aggregated: 'none' })
    expect(compactTrades([], 12)).toEqual({ items: [], aggregated: 'none' })
  })

  it('keeps the newest N trades and the last trade of every second, in ts order', () => {
    // 3 seconds (1, 2, 3) with 50 trades each; the newest 4 are all in second 3.
    const items = spread(150, 1_000, 4_000)
    const { items: kept } = compactTrades(items, 4)
    const lastOfSecond1 = items[49]
    const lastOfSecond2 = items[99]
    expect(kept).toEqual([lastOfSecond1, lastOfSecond2, ...items.slice(-4)])
  })

  it('does not duplicate a trade that is both a second-closer and among the newest', () => {
    const items = spread(30, 1_000, 2_000)
    const { items: kept } = compactTrades(items, 3)
    // The last trade of second 1 is also the newest trade: kept once.
    expect(kept).toEqual(items.slice(-3))
  })

  it('always keeps user trades, wherever they are in the batch', () => {
    const items = [...spread(20, 1_000, 1_400), user(21, 1_450), ...spread(20, 1_500, 1_900, 22)]
    const { items: kept } = compactTrades(items, 2)
    expect(kept.filter((t) => t.source === 'user').map((t) => t.id)).toEqual([21])
    expect(kept.map((t) => t.id)).toEqual([21, 40, 41])
  })

  it('summarises exactly the omitted trades: count and volume add up', () => {
    const items = spread(100, 1_000, 3_000).map((t, i) => ({ ...t, shares: 1 + (i % 7) }))
    const { items: kept, aggregated } = compactTrades(items, 12)
    if (aggregated === 'none') throw new Error('expected an aggregate')
    expect(kept.length + aggregated.count).toBe(items.length)
    const totalShares = items.reduce((sum, t) => sum + t.shares, 0)
    const keptShares = kept.reduce((sum, t) => sum + t.shares, 0)
    expect(aggregated.volumeShares).toBeCloseTo(totalShares - keptShares, 9)
    // Kept items are a strictly ts/id-ordered subsequence of the input.
    for (let i = 1; i < kept.length; i++) expect(kept[i].id).toBeGreaterThan(kept[i - 1].id)
  })

  it('preserves the last price of every second (what the chart plots)', () => {
    const items = spread(5_000, 10_000, 14_000)
    const lastPerSecond = (trades: readonly Trade[]): Map<number, number> => {
      const map = new Map<number, number>()
      for (const t of trades) map.set(Math.floor(t.ts / 1_000), t.priceAfter)
      return map
    }
    const { items: kept } = compactTrades(items, 12)
    expect(lastPerSecond(kept)).toEqual(lastPerSecond(items))
    expect(kept.length).toBeLessThanOrEqual(12 + 4)
  })
})
