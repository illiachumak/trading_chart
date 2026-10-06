import { describe, expect, it } from 'vitest'
import { type CountSample, ratesPerSecond, trailingPerMinute } from '@/lib/perf/rates'

describe('ratesPerSecond', () => {
  it('divides counter deltas by elapsed seconds, treating new keys as starting at 0', () => {
    expect(ratesPerSecond({ chart: 4, feed: 30 }, { feed: 10 }, 2_000)).toEqual({ chart: 2, feed: 10 })
  })

  it('returns an empty object for a non-positive window', () => {
    expect(ratesPerSecond({ a: 1 }, {}, 0)).toEqual({})
  })
})

describe('trailingPerMinute', () => {
  it('rates over the trailing window only', () => {
    const samples: CountSample[] = [{ at: 0, total: 0 }]
    expect(trailingPerMinute(samples, { at: 30_000, total: 10 }, 60_000)).toBe(20)
    expect(trailingPerMinute(samples, { at: 60_000, total: 10 }, 60_000)).toBe(10)
    // The first 30 s (10 events) fall out of the window: 2 events in the last 60 s.
    expect(trailingPerMinute(samples, { at: 90_000, total: 12 }, 60_000)).toBe(2)
    expect(samples.map((s) => s.at)).toEqual([30_000, 60_000, 90_000])
  })

  it('is 0 before time passes', () => {
    expect(trailingPerMinute([], { at: 5, total: 3 }, 60_000)).toBe(0)
  })
})
