import { describe, expect, it } from 'vitest'
import { PerfMetrics, type SamplingEnv } from '@/lib/perf/perf-metrics'
import { RollingStat } from '@/lib/perf/rolling-stat'

describe('RollingStat', () => {
  it('computes nearest-rank percentiles and max', () => {
    const stat = new RollingStat(1_000)
    for (let i = 1; i <= 100; i++) stat.add(i)
    expect(stat.percentile(0.5)).toBe(50)
    expect(stat.percentile(0.95)).toBe(95)
    expect(stat.max()).toBe(100)
  })

  it('evicts the oldest values beyond capacity', () => {
    const stat = new RollingStat(3)
    for (const v of [100, 1, 2, 3]) stat.add(v)
    expect(stat.count).toBe(3)
    expect(stat.max()).toBe(3)
  })

  it('returns 0 when empty', () => {
    expect(new RollingStat(3).percentile(0.5)).toBe(0)
  })
})

function fakeEnv() {
  const frames = new Map<number, (t: number) => void>()
  let next = 0
  let observers = 0
  const env: SamplingEnv = {
    requestFrame: (callback) => {
      const handle = ++next
      frames.set(handle, callback)
      return () => {
        frames.delete(handle)
      }
    },
    observeLongTasks: () => {
      observers++
      return () => {
        observers--
      }
    },
  }
  const runFrame = (time: number) => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(time)
  }
  return { env, runFrame, frameCount: () => frames.size, observers: () => observers }
}

describe('PerfMetrics', () => {
  it('aggregates flushes, commits and long tasks', () => {
    const metrics = new PerfMetrics(100)
    metrics.recordFlush({ mode: 'update', durationMs: 0.2, ticks: 5, points: 1, latencyMs: 30 })
    metrics.recordFlush({ mode: 'setData', durationMs: 0.8, ticks: 40, points: 31, latencyMs: 50 })
    metrics.recordCommit('chart')
    metrics.recordCommit('panel')
    metrics.recordCommit('panel')
    metrics.recordLongTask(70)
    const snap = metrics.snapshot()
    expect(snap.flushMax).toBe(0.8)
    expect(snap.latencyP95).toBe(50)
    expect(snap.totals).toEqual({
      flushes: 2,
      setDataFlushes: 1,
      longTasks: 1,
      longTaskMaxMs: 70,
      commits: { chart: 1, panel: 2 },
    })
  })

  it('runs one ref-counted frame loop and derives fps', () => {
    const metrics = new PerfMetrics(100)
    const fake = fakeEnv()
    const releaseA = metrics.acquireSampling(fake.env)
    const releaseB = metrics.acquireSampling(fake.env)
    expect(fake.frameCount()).toBe(1)
    expect(fake.observers()).toBe(1)
    for (let i = 0; i <= 10; i++) fake.runFrame(i * 20)
    expect(metrics.snapshot().fps).toBe(50)
    releaseA()
    expect(fake.frameCount()).toBe(1)
    releaseB()
    expect(fake.frameCount()).toBe(0)
    expect(fake.observers()).toBe(0)
  })

  it('ignores frame gaps over 1s (hidden tab)', () => {
    const metrics = new PerfMetrics(100)
    const fake = fakeEnv()
    metrics.acquireSampling(fake.env)
    for (const t of [0, 20, 40, 60_000, 60_020]) fake.runFrame(t)
    expect(metrics.snapshot().frameP95).toBe(20)
  })

  it('clearSamples resets percentiles but keeps totals', () => {
    const metrics = new PerfMetrics(100)
    metrics.recordFlush({ mode: 'update', durationMs: 5, ticks: 1, points: 1, latencyMs: 1 })
    metrics.clearSamples()
    expect(metrics.snapshot().flushMax).toBe(0)
    expect(metrics.snapshot().totals.flushes).toBe(1)
  })
})
