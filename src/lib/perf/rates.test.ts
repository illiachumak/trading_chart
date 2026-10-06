import { describe, expect, it } from 'vitest'
import { ratesPerSecond } from '@/lib/perf/rates'

describe('ratesPerSecond', () => {
  it('divides counter deltas by elapsed seconds, treating new keys as starting at 0', () => {
    expect(ratesPerSecond({ chart: 4, feed: 30 }, { feed: 10 }, 2_000)).toEqual({ chart: 2, feed: 10 })
  })

  it('returns an empty object for a non-positive window', () => {
    expect(ratesPerSecond({ a: 1 }, {}, 0)).toEqual({})
  })
})
