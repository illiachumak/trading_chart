import { describe, expect, it } from 'vitest'
import {
  buyShares,
  buyWithBudget,
  costForShares,
  maxSharesToBound,
  sharesForCost,
  sidePrice,
  yesPrice,
} from '@/server/lmsr'
import { createRng, exponential } from '@/server/rng'

const B = 3_000
const BOUND = 0.85

describe('lmsr', () => {
  it('starts at 50/50 and the sides sum to 1', () => {
    expect(yesPrice(0, B)).toBe(0.5)
    expect(sidePrice(400, 'yes', B) + sidePrice(400, 'no', B)).toBeCloseTo(1, 12)
  })

  it('sharesForCost inverts costForShares', () => {
    const shares = sharesForCost(250, 'no', 100, B)
    expect(costForShares(250, 'no', shares, B)).toBeCloseTo(100, 9)
  })

  it('buying YES raises the YES price, buying NO lowers it', () => {
    const yes = buyShares(0, 'yes', 15, B, BOUND)
    const no = buyShares(0, 'no', 15, B, BOUND)
    expect(yesPrice(yes.diffAfter, B)).toBeGreaterThan(0.5)
    expect(yesPrice(no.diffAfter, B)).toBeLessThan(0.5)
    // ~0.1¢ move for a typical mock trade
    expect(yesPrice(yes.diffAfter, B) - 0.5).toBeCloseTo(0.00125, 4)
  })

  it('clips a budget that would cross the bound and reports clipped', () => {
    const fill = buyWithBudget(0, 'yes', 10_000, B, BOUND)
    expect(fill.clipped).toBe(true)
    expect(fill.shares).toBeCloseTo(maxSharesToBound(0, 'yes', B, BOUND), 9)
    expect(yesPrice(fill.diffAfter, B)).toBeCloseTo(BOUND, 9)
    expect(fill.cost).toBeLessThan(10_000)
  })

  it('does not clip a budget that stays inside the bound', () => {
    const fill = buyWithBudget(0, 'no', 100, B, BOUND)
    expect(fill.clipped).toBe(false)
    expect(fill.cost).toBe(100)
  })

  it('returns zero shares once the side is at the bound', () => {
    const atBound = buyWithBudget(0, 'no', 10_000, B, BOUND).diffAfter
    expect(maxSharesToBound(atBound, 'no', B, BOUND)).toBeLessThanOrEqual(1e-6)
    expect(buyShares(atBound, 'no', 50, B, BOUND).shares).toBeLessThanOrEqual(1e-6)
  })
})

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = createRng(7)
    const b = createRng(7)
    const values = Array.from({ length: 100 }, () => a())
    expect(values).toEqual(Array.from({ length: 100 }, () => b()))
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('exponential draws have roughly the requested mean', () => {
    const rng = createRng(1)
    const n = 20_000
    let sum = 0
    for (let i = 0; i < n; i++) sum += exponential(rng, 10)
    expect(sum / n).toBeGreaterThan(9.5)
    expect(sum / n).toBeLessThan(10.5)
  })
})
