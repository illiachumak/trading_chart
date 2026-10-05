import { describe, expect, it } from 'vitest'
import { createCoinflipResolver } from '@/server/resolvers/coinflip-resolver'
import { ArrivalGenerator, drawShares, MEAN_REVERTING_TRADERS } from '@/server/mock-traders'
import { createRng } from '@/server/rng'

describe('ArrivalGenerator', () => {
  it('produces ~rate arrivals per second with ascending ts inside the window', () => {
    const gen = new ArrivalGenerator(createRng(3), 0, 50)
    const arrivals = gen.generate(10_000)
    expect(arrivals.length).toBeGreaterThan(400)
    expect(arrivals.length).toBeLessThan(600)
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i].ts).toBeGreaterThanOrEqual(arrivals[i - 1].ts)
    }
    expect(arrivals.every((a) => a.ts <= 10_000 && a.shares > 0)).toBe(true)
  })

  it('continues from where the previous window ended', () => {
    const gen = new ArrivalGenerator(createRng(3), 0, 50)
    const first = gen.generate(1_000)
    const second = gen.generate(2_000)
    expect(second.every((a) => a.ts > 1_000)).toBe(true)
    expect(first.length + second.length).toBeGreaterThan(60)
  })

  it('respects rate changes', () => {
    const gen = new ArrivalGenerator(createRng(5), 0, 5)
    gen.generate(1_000)
    gen.setRate(200)
    expect(gen.generate(2_000).length).toBeGreaterThan(120)
  })
})

describe('drawShares', () => {
  it('draws positive sizes rounded to cents', () => {
    const rng = createRng(9)
    for (let i = 0; i < 1_000; i++) {
      const s = drawShares(rng)
      expect(s).toBeGreaterThanOrEqual(5)
      expect(Math.round(s * 100)).toBeCloseTo(s * 100, 6)
    }
  })
})

describe('MEAN_REVERTING_TRADERS', () => {
  it('buys the cheap side more often near the bounds', () => {
    const rng = createRng(11)
    const n = 5_000
    let yesAtHigh = 0
    let yesAtLow = 0
    for (let i = 0; i < n; i++) {
      if (MEAN_REVERTING_TRADERS.pickSide(0.85, rng) === 'yes') yesAtHigh++
      if (MEAN_REVERTING_TRADERS.pickSide(0.15, rng) === 'yes') yesAtLow++
    }
    expect(yesAtHigh / n).toBeLessThan(0.35)
    expect(yesAtLow / n).toBeGreaterThan(0.65)
  })
})

describe('coinflip resolver', () => {
  it('is roughly fair', () => {
    const resolver = createCoinflipResolver(createRng(13))
    const round = { id: 1, startTs: 0, endTs: 60_000 }
    let yes = 0
    for (let i = 0; i < 10_000; i++) if (resolver.resolve(round) === 'yes') yes++
    expect(yes / 10_000).toBeGreaterThan(0.47)
    expect(yes / 10_000).toBeLessThan(0.53)
  })
})
