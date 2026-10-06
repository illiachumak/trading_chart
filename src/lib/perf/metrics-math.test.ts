import { describe, expect, it } from 'vitest'
import {
  estimateDisplayHz,
  groupInteractions,
  pctOverBudget,
  percentile,
  percentileOfSorted,
  recoveryTimes,
  summarizeInteractions,
} from '@/lib/perf/metrics-math'

describe('percentile', () => {
  it('uses nearest rank and does not mutate the input', () => {
    const values = [5, 1, 4, 2, 3]
    expect(percentile(values, 0.5)).toBe(3)
    expect(percentile(values, 0.99)).toBe(5)
    expect(percentile(values, 0)).toBe(1)
    expect(values).toEqual([5, 1, 4, 2, 3])
  })

  it('p50/p95/p99 over 1..100', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
    expect([0.5, 0.95, 0.99].map((p) => percentileOfSorted(sorted, p))).toEqual([50, 95, 99])
  })

  it('is 0 when empty', () => {
    expect(percentile([], 0.95)).toBe(0)
  })
})

describe('pctOverBudget', () => {
  it('counts frames strictly over the budget', () => {
    expect(pctOverBudget([16.6, 16.7, 16.8, 33.4], 16.7)).toBe(50)
  })

  it('is 0 without frames', () => {
    expect(pctOverBudget([], 16.7)).toBe(0)
  })
})

describe('estimateDisplayHz', () => {
  it('snaps to common refresh rates', () => {
    expect(estimateDisplayHz(16.67)).toBe(60)
    expect(estimateDisplayHz(16.9)).toBe(60)
    expect(estimateDisplayHz(8.33)).toBe(120)
    expect(estimateDisplayHz(6.94)).toBe(144)
  })

  it('reports an off-grid median as measured', () => {
    expect(estimateDisplayHz(25)).toBe(40)
  })

  it('is n/a without frames', () => {
    expect(estimateDisplayHz(0)).toBe('n/a')
    expect(estimateDisplayHz(Number.NaN)).toBe('n/a')
  })
})

describe('INP grouping', () => {
  it('one interaction per id, latency = longest entry; id 0 is not an interaction', () => {
    const grouped = groupInteractions([
      { interactionId: 7, durationMs: 24 }, // pointerdown
      { interactionId: 7, durationMs: 40 }, // click
      { interactionId: 0, durationMs: 200 }, // pointermove
      { interactionId: 9, durationMs: 16 },
    ])
    expect([...grouped]).toEqual([
      [7, 40],
      [9, 16],
    ])
  })

  it('accumulates entries of one interaction across observer callbacks', () => {
    const map = groupInteractions([{ interactionId: 3, durationMs: 50 }])
    groupInteractions([{ interactionId: 3, durationMs: 30 }], map)
    expect(map.get(3)).toBe(50)
  })

  it('p75 / max / count per window, n/a when empty', () => {
    expect(summarizeInteractions([10, 40, 20, 30])).toEqual({ count: 4, p75Ms: 30, maxMs: 40 })
    expect(summarizeInteractions([])).toEqual({ count: 0, p75Ms: 'n/a', maxMs: 'n/a' })
  })
})

describe('recoveryTimes', () => {
  it('measures each outage from leaving live to the next live', () => {
    expect(
      recoveryTimes([
        { at: 0, status: 'live' },
        { at: 1_000, status: 'reconnecting' },
        { at: 1_300, status: 'resyncing' },
        { at: 1_350, status: 'live' },
        { at: 5_000, status: 'reconnecting' },
        { at: 5_100, status: 'reconnecting' },
        { at: 5_900, status: 'live' },
      ]),
    ).toEqual({ recoveredMs: [350, 900], unrecovered: 0 })
  })

  it('an outage in progress at the start counts from the first sample; one open at the end is unrecovered', () => {
    expect(
      recoveryTimes([
        { at: 100, status: 'resyncing' },
        { at: 400, status: 'live' },
        { at: 900, status: 'reconnecting' },
      ]),
    ).toEqual({ recoveredMs: [300], unrecovered: 1 })
  })

  it('no outages → nothing recovered', () => {
    expect(recoveryTimes([{ at: 0, status: 'live' }])).toEqual({ recoveredMs: [], unrecovered: 0 })
    expect(recoveryTimes([])).toEqual({ recoveredMs: [], unrecovered: 0 })
  })
})
