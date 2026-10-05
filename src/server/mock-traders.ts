import { MAX_TRADES_PER_SEC, MIN_TRADES_PER_SEC } from '@/config/market'
import type { Side } from '@/lib/realtime/protocol'
import { exponential, type Rng } from '@/server/rng'

export type MockArrival = { ts: number; shares: number }

/** Decides which side a mock trader buys. BTC mode will plug in a model biased by the BTC price. */
export type MockTraderModel = { pickSide(yesPrice: number, rng: Rng): Side }

const MEAN_REVERSION = 0.6

export const MEAN_REVERTING_TRADERS: MockTraderModel = {
  pickSide(yesPrice, rng) {
    const yesProbability = 0.5 - MEAN_REVERSION * (yesPrice - 0.5)
    return rng() < yesProbability ? 'yes' : 'no'
  },
}

const MIN_SHARES = 5
const MEAN_EXTRA_SHARES = 15
const WHALE_CHANCE = 0.05
const WHALE_MULTIPLIER = 5

export function drawShares(rng: Rng): number {
  const base = MIN_SHARES + exponential(rng, MEAN_EXTRA_SHARES)
  const multiplier = rng() < WHALE_CHANCE ? WHALE_MULTIPLIER : 1
  return Math.round(base * multiplier * 100) / 100
}

function clampRate(tradesPerSec: number): number {
  if (!Number.isFinite(tradesPerSec)) return MIN_TRADES_PER_SEC
  return Math.min(MAX_TRADES_PER_SEC, Math.max(MIN_TRADES_PER_SEC, tradesPerSec))
}

/** Poisson arrivals: exponential inter-arrival times at the configured rate. */
export class ArrivalGenerator {
  private readonly rng: Rng
  private rate: number
  private nextTs: number

  constructor(rng: Rng, startTs: number, tradesPerSec: number) {
    this.rng = rng
    this.rate = clampRate(tradesPerSec)
    this.nextTs = startTs + this.gap()
  }

  setRate(tradesPerSec: number): void {
    this.rate = clampRate(tradesPerSec)
  }

  generate(untilTs: number): MockArrival[] {
    const arrivals: MockArrival[] = []
    while (this.nextTs <= untilTs) {
      arrivals.push({ ts: Math.floor(this.nextTs), shares: drawShares(this.rng) })
      this.nextTs += this.gap()
    }
    return arrivals
  }

  private gap(): number {
    return exponential(this.rng, 1_000 / this.rate)
  }
}
