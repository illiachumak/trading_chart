// Logarithmic Market Scoring Rule for a binary market.
// State is `diff = qYes - qNo`; prices depend only on it.
// Price of a side `ps`; buying Δ shares of it costs b·ln(ps·e^(Δ/b) + 1 − ps).

import type { Side } from '@/lib/realtime/protocol'

export type Fill = { shares: number; cost: number; diffAfter: number; clipped: boolean }

export function yesPrice(diff: number, liquidity: number): number {
  return 1 / (1 + Math.exp(-diff / liquidity))
}

export function sidePrice(diff: number, side: Side, liquidity: number): number {
  const p = yesPrice(diff, liquidity)
  return side === 'yes' ? p : 1 - p
}

export function costForShares(diff: number, side: Side, shares: number, liquidity: number): number {
  const ps = sidePrice(diff, side, liquidity)
  return liquidity * Math.log(ps * Math.exp(shares / liquidity) + 1 - ps)
}

export function sharesForCost(diff: number, side: Side, cost: number, liquidity: number): number {
  const ps = sidePrice(diff, side, liquidity)
  return liquidity * Math.log((Math.exp(cost / liquidity) - 1 + ps) / ps)
}

/** Shares of `side` that move its price exactly to `bound`. */
export function maxSharesToBound(diff: number, side: Side, liquidity: number, bound: number): number {
  const ps = sidePrice(diff, side, liquidity)
  if (ps >= bound) return 0
  return Math.max(0, liquidity * Math.log((bound * (1 - ps)) / ((1 - bound) * ps)))
}

function shift(diff: number, side: Side, shares: number): number {
  return side === 'yes' ? diff + shares : diff - shares
}

export function buyWithBudget(diff: number, side: Side, budget: number, liquidity: number, bound: number): Fill {
  const wanted = sharesForCost(diff, side, budget, liquidity)
  const cap = maxSharesToBound(diff, side, liquidity, bound)
  if (wanted <= cap) {
    return { shares: wanted, cost: budget, diffAfter: shift(diff, side, wanted), clipped: false }
  }
  return {
    shares: cap,
    cost: costForShares(diff, side, cap, liquidity),
    diffAfter: shift(diff, side, cap),
    clipped: true,
  }
}

export function buyShares(diff: number, side: Side, shares: number, liquidity: number, bound: number): Fill {
  const filled = Math.min(shares, maxSharesToBound(diff, side, liquidity, bound))
  return {
    shares: filled,
    cost: costForShares(diff, side, filled, liquidity),
    diffAfter: shift(diff, side, filled),
    clipped: filled < shares,
  }
}
