// Server-side aggregation of a `trades` batch (AggregationMode 'compact').
// The chart plots the last price of each second, so keeping the last trade of every second
// makes the client's chart identical to the full stream by construction.

import type { Trade, TradeAggregate } from '@/lib/realtime/protocol'

export type CompactedTrades = { items: Trade[]; aggregated: TradeAggregate | 'none' }

function toSecond(ts: number): number {
  return Math.floor(ts / 1_000)
}

/**
 * Keeps (a) the last trade of each second, (b) the newest `feedLimit` trades and (c) every user
 * trade; the rest is summarised. `items` must be ts-ordered; the kept trades stay in that order.
 */
export function compactTrades(items: readonly Trade[], feedLimit: number): CompactedTrades {
  if (items.length <= feedLimit) return { items: [...items], aggregated: 'none' }
  const kept: Trade[] = []
  let count = 0
  let volumeShares = 0
  const newestFrom = items.length - feedLimit
  for (let i = 0; i < items.length; i++) {
    const trade = items[i]
    const next = items[i + 1]
    const closesSecond = next === undefined || toSecond(next.ts) !== toSecond(trade.ts)
    if (closesSecond || i >= newestFrom || trade.source === 'user') {
      kept.push(trade)
    } else {
      count++
      volumeShares += trade.shares
    }
  }
  return { items: kept, aggregated: count > 0 ? { count, volumeShares } : 'none' }
}
