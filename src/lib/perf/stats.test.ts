import { describe, expect, it } from 'vitest'
import { holmBonferroni, mean, meanCI, sampleSd, tQuantile975, tTwoSidedP, welchDiffCI } from '@/lib/perf/stats'

// Reference values from scipy.stats (t.ppf(0.975, df), sample sd with ddof=1, Welch t-interval).

describe('mean / sampleSd', () => {
  it('computes the mean and the n − 1 sample standard deviation', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3)
    expect(sampleSd([1, 2, 3, 4, 5])).toBeCloseTo(1.5811388, 6)
    expect(sampleSd([4, 6, 7, 9, 10, 12, 15])).toBeCloseTo(3.7416574, 6)
  })

  it('throws on too few values', () => {
    expect(() => mean([])).toThrow(RangeError)
    expect(() => sampleSd([1])).toThrow(RangeError)
  })
})

describe('tQuantile975', () => {
  it('matches the two-sided 95% t table for integer df', () => {
    expect(tQuantile975(1)).toBeCloseTo(12.7062, 4)
    expect(tQuantile975(4)).toBeCloseTo(2.7764, 4)
    expect(tQuantile975(9)).toBeCloseTo(2.2622, 4)
    expect(tQuantile975(30)).toBeCloseTo(2.0423, 4)
  })

  it('interpolates fractional df (Welch) closely', () => {
    expect(tQuantile975(4.5)).toBeCloseTo(2.6589, 2)
    expect(tQuantile975(7.3)).toBeCloseTo(2.3451, 2)
    expect(tQuantile975(8.5714)).toBeCloseTo(2.2795, 3)
  })

  it('falls back to a normal-based expansion above the table', () => {
    expect(tQuantile975(40)).toBeCloseTo(2.0211, 3)
    expect(tQuantile975(100)).toBeCloseTo(1.984, 3)
    expect(tQuantile975(1e9)).toBeCloseTo(1.96, 2)
  })

  it('clamps df below 1 to 1', () => {
    expect(tQuantile975(0.5)).toBeCloseTo(12.7062, 4)
  })
})

describe('meanCI', () => {
  it('returns the mean with the 95% t-interval half-width', () => {
    const ci = meanCI([1, 2, 3, 4, 5])
    expect(ci.mean).toBe(3)
    expect(ci.n).toBe(5)
    expect(ci.ci95).toBeCloseTo(1.9632432, 6)
  })

  it('reports no interval for a single value', () => {
    expect(meanCI([7])).toEqual({ mean: 7, ci95: 'n/a', n: 1 })
  })
})

describe('welchDiffCI', () => {
  it('returns B − A with the Welch interval and Welch–Satterthwaite df', () => {
    const d = welchDiffCI([1, 2, 3, 4, 5], [4, 6, 7, 9, 10, 12, 15])
    if (d === 'n/a') throw new Error('expected an interval')
    expect(d.diff).toBe(6)
    expect(d.df).toBeCloseTo(8.5714286, 6)
    expect(d.low).toBeCloseTo(2.3958, 2)
    expect(d.high).toBeCloseTo(9.6042, 2)
    expect(d.significant).toBe(true)
    expect(d.p).toBeCloseTo(0.0046475, 6)
  })

  it('does not flag a change when the interval contains zero', () => {
    const d = welchDiffCI([10, 12, 11, 13, 9], [11, 13, 10, 12, 14])
    if (d === 'n/a') throw new Error('expected an interval')
    expect(d.diff).toBe(1)
    expect(d.df).toBeCloseTo(8, 6)
    expect(d.low).toBeCloseTo(-1.306, 3)
    expect(d.high).toBeCloseTo(3.306, 3)
    expect(d.significant).toBe(false)
    expect(d.p).toBeCloseTo(0.3465935, 6)
  })

  it('handles zero variance on both sides', () => {
    expect(welchDiffCI([2, 2, 2], [2, 2])).toEqual({ diff: 0, low: 0, high: 0, df: 3, significant: false, p: 1 })
    expect(welchDiffCI([2, 2, 2], [3, 3])).toEqual({ diff: 1, low: 1, high: 1, df: 3, significant: true, p: 0 })
  })

  it('is n/a with fewer than two values on a side', () => {
    expect(welchDiffCI([1], [1, 2, 3])).toBe('n/a')
    expect(welchDiffCI([1, 2], [])).toBe('n/a')
  })
})

describe('tTwoSidedP', () => {
  it('matches the two-sided Student t tail probability for integer and fractional df', () => {
    expect(tTwoSidedP(2.5, 3.7)).toBeCloseTo(0.0718220, 6)
    expect(tTwoSidedP(0.3, 1)).toBeCloseTo(0.8144528, 6)
    expect(tTwoSidedP(4, 2.2)).toBeCloseTo(0.0487306, 6)
    expect(tTwoSidedP(10, 50)).toBeCloseTo(1.6077e-13, 15)
  })

  it('is symmetric in t and 1 at t = 0', () => {
    expect(tTwoSidedP(-2.5, 3.7)).toBeCloseTo(tTwoSidedP(2.5, 3.7), 12)
    expect(tTwoSidedP(0, 5)).toBe(1)
  })
})

describe('holmBonferroni', () => {
  it('rejects step-down against alpha / (m − rank), keeping the input order', () => {
    // m = 4, sorted: 0.01 ≤ 0.0125 ✓, 0.015 ≤ 0.0167 ✓, 0.03 > 0.025 ✗ (stop), 0.04 not tested.
    expect(holmBonferroni([0.04, 0.01, 0.03, 0.015], 0.05)).toEqual([false, true, false, true])
  })

  it('stops at the first non-rejection even when a later p-value would pass its own threshold', () => {
    // m = 3: 0.02 > 0.0167 ✗ → nothing rejected although 0.03 ≤ 0.05 / 1.
    expect(holmBonferroni([0.02, 0.03, 0.03], 0.05)).toEqual([false, false, false])
  })

  it('is stricter than uncorrected testing but equals it for a single test', () => {
    expect(holmBonferroni([0.04], 0.05)).toEqual([true])
    expect(holmBonferroni([0.04, 0.04], 0.05)).toEqual([false, false])
  })

  it('handles no tests and defaults alpha to 0.05', () => {
    expect(holmBonferroni([])).toEqual([])
    expect(holmBonferroni([0.001, 0.2])).toEqual([true, false])
  })
})
