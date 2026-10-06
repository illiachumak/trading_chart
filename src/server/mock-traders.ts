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
  /** End of the last generated window: nothing at or before it is generated again. */
  private generatedUntil: number

  constructor(rng: Rng, startTs: number, tradesPerSec: number) {
    this.rng = rng
    this.rate = clampRate(tradesPerSec)
    this.generatedUntil = startTs
    this.nextTs = startTs + this.gap()
  }

  getRate(): number {
    return this.rate
  }

  /** Takes effect immediately: Poisson arrivals are memoryless, so the pending gap is redrawn. */
  setRate(tradesPerSec: number): void {
    this.rate = clampRate(tradesPerSec)
    this.nextTs = this.generatedUntil + this.gap()
  }

  generate(untilTs: number): MockArrival[] {
    this.generatedUntil = Math.max(this.generatedUntil, untilTs)
    const arrivals: MockArrival[] = []
    while (this.nextTs <= untilTs) {
      // ceil: never stamp an arrival at or before the window that was already executed.
      arrivals.push({ ts: Math.ceil(this.nextTs), shares: drawShares(this.rng) })
      this.nextTs += this.gap()
    }
    return arrivals
  }

  private gap(): number {
    return exponential(this.rng, 1_000 / this.rate)
  }
}
