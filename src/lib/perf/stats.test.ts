import { describe, expect, it } from 'vitest'
import { mean, meanCI, sampleSd, tQuantile975, welchDiffCI } from '@/lib/perf/stats'

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
  })

  it('does not flag a change when the interval contains zero', () => {
    const d = welchDiffCI([10, 12, 11, 13, 9], [11, 13, 10, 12, 14])
    if (d === 'n/a') throw new Error('expected an interval')
    expect(d.diff).toBe(1)
    expect(d.df).toBeCloseTo(8, 6)
    expect(d.low).toBeCloseTo(-1.306, 3)
    expect(d.high).toBeCloseTo(3.306, 3)
    expect(d.significant).toBe(false)
  })

  it('handles zero variance on both sides', () => {
    expect(welchDiffCI([2, 2, 2], [2, 2])).toEqual({ diff: 0, low: 0, high: 0, df: 3, significant: false })
    expect(welchDiffCI([2, 2, 2], [3, 3])).toEqual({ diff: 1, low: 1, high: 1, df: 3, significant: true })
  })

  it('is n/a with fewer than two values on a side', () => {
    expect(welchDiffCI([1], [1, 2, 3])).toBe('n/a')
    expect(welchDiffCI([1, 2], [])).toBe('n/a')
  })
})
