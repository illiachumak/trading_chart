import { describe, expect, it } from 'vitest'
import { type LongAnimationFrameSample, PerfMetrics, type SamplingEnv } from '@/lib/perf/perf-metrics'
import type { EventTimingSample } from '@/lib/perf/metrics-math'
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

function fakeEnv(supported = true) {
  const frames = new Map<number, (t: number) => void>()
  let next = 0
  let observers = 0
  let emitLoaf: (frame: LongAnimationFrameSample) => void = () => {}
  let emitEvents: (entries: EventTimingSample[]) => void = () => {}
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
    observeLongAnimationFrames: (onFrame) => {
      if (!supported) return { supported: false, stop: () => {} }
      observers++
      emitLoaf = onFrame
      return { supported: true, stop: () => observers-- }
    },
    observeEventTiming: (onEntries) => {
      if (!supported) return { supported: false, stop: () => {} }
      observers++
      emitEvents = onEntries
      return { supported: true, stop: () => observers-- }
    },
  }
  const runFrame = (time: number) => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(time)
  }
  return {
    env,
    runFrame,
    frameCount: () => frames.size,
    observers: () => observers,
    loaf: (frame: LongAnimationFrameSample) => emitLoaf(frame),
    events: (entries: EventTimingSample[]) => emitEvents(entries),
  }
}

describe('PerfMetrics', () => {
  it('aggregates flushes, commits and long tasks', () => {
    const metrics = new PerfMetrics(100)
    metrics.recordFlush({ mode: 'update', durationMs: 0.2, ticks: 5, points: 1, dataAgeMs: 30 })
    metrics.recordFlush({ mode: 'setData', durationMs: 0.8, ticks: 40, points: 31, dataAgeMs: 50 })
    metrics.recordCommit('chart')
    metrics.recordCommit('panel')
    metrics.recordCommit('panel')
    metrics.recordLongTask(70)
    const snap = metrics.snapshot()
    expect(snap.flushMax).toBe(0.8)
    expect(snap.dataAgeP95).toBe(50)
    expect(snap.totals).toEqual({
      flushes: 2,
      setDataFlushes: 1,
      longTasks: 1,
      longTaskMaxMs: 70,
      longAnimationFrames: 0,
      commits: { chart: 1, panel: 2 },
    })
  })

  it('runs one ref-counted frame loop and derives fps', () => {
    const metrics = new PerfMetrics(100)
    const fake = fakeEnv()
    const releaseA = metrics.acquireSampling(fake.env)
    const releaseB = metrics.acquireSampling(fake.env)
    expect(fake.frameCount()).toBe(1)
    expect(fake.observers()).toBe(3)
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
    metrics.recordFlush({ mode: 'update', durationMs: 5, ticks: 1, points: 1, dataAgeMs: 1 })
    metrics.clearSamples()
    expect(metrics.snapshot().flushMax).toBe(0)
    expect(metrics.snapshot().totals.flushes).toBe(1)
  })

  it('tracks the long-task max per window: clearSamples resets it, the all-time max is kept', () => {
    const metrics = new PerfMetrics(100)
    metrics.recordLongTask(300)
    metrics.clearSamples()
    expect(metrics.snapshot().windowLongTaskMaxMs).toBe(0)
    metrics.recordLongTask(80)
    expect(metrics.snapshot().windowLongTaskMaxMs).toBe(80)
    expect(metrics.snapshot().totals.longTaskMaxMs).toBe(300)
  })

  it('frame percentiles, % over the ~25 ms miss threshold and display Hz', () => {
    const metrics = new PerfMetrics(1_000)
    // 90 frames at 60 Hz, 8 dropped frames (33.3 ms), 2 long ones.
    for (let i = 0; i < 90; i++) metrics.recordFrame(16.67)
    for (let i = 0; i < 8; i++) metrics.recordFrame(33.3)
    metrics.recordFrame(50)
    metrics.recordFrame(120)
    const snap = metrics.snapshot()
    expect(snap.frameP50).toBe(16.67)
    expect(snap.frameP95).toBe(33.3)
    expect(snap.frameP99).toBe(50)
    expect(snap.pctFramesOverBudget).toBe(10)
    expect(snap.displayHz).toBe(60)
    expect(snap.fps).toBe(60)
  })

  it('collects LoAF and INP per window; totals survive clearSamples', () => {
    const metrics = new PerfMetrics(100)
    const fake = fakeEnv()
    metrics.acquireSampling(fake.env)
    fake.loaf({ durationMs: 80, blockingMs: 20 })
    fake.loaf({ durationMs: 60, blockingMs: 35 })
    fake.events([
      { interactionId: 1, durationMs: 24 },
      { interactionId: 1, durationMs: 48 },
      { interactionId: 0, durationMs: 300 },
    ])
    fake.events([{ interactionId: 2, durationMs: 16 }])
    let snap = metrics.snapshot()
    expect([snap.loafSupported, snap.inpSupported]).toEqual([true, true])
    expect([snap.windowLoafMaxMs, snap.windowLoafBlockingMaxMs, snap.totals.longAnimationFrames]).toEqual([80, 35, 2])
    expect(snap.interactions).toEqual({ count: 2, p75Ms: 48, maxMs: 48 })
    metrics.clearSamples()
    snap = metrics.snapshot()
    expect([snap.windowLoafMaxMs, snap.windowLoafBlockingMaxMs, snap.totals.longAnimationFrames]).toEqual([0, 0, 2])
    expect(snap.interactions).toEqual({ count: 0, p75Ms: 'n/a', maxMs: 'n/a' })
  })

  it('reports unsupported observers', () => {
    const metrics = new PerfMetrics(100)
    const release = metrics.acquireSampling(fakeEnv(false).env)
    const snap = metrics.snapshot()
    expect([snap.loafSupported, snap.inpSupported]).toEqual([false, false])
    release()
  })

  it('caps interactions per window at capacity', () => {
    const metrics = new PerfMetrics(2)
    metrics.recordEventTiming([1, 2, 3].map((id) => ({ interactionId: id, durationMs: 20 })))
    metrics.recordEventTiming([{ interactionId: 2, durationMs: 90 }])
    expect(metrics.snapshot().interactions).toEqual({ count: 2, p75Ms: 90, maxMs: 90 })
  })
})
