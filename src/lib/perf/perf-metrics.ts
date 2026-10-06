// Collectors for the perf HUD and the benchmark. Percentiles are over a rolling window;
// totals are cumulative so several readers can compute their own rates from deltas.

import { PERF_SAMPLE_CAPACITY } from '@/config/market'
import { RollingStat } from '@/lib/perf/rolling-stat'
import type { FlushStats } from '@/lib/realtime/chart-feeder'

export type PerfTotals = {
  flushes: number
  setDataFlushes: number
  longTasks: number
  longTaskMaxMs: number
  commits: Readonly<Record<string, number>>
}

export type PerfSnapshot = {
  fps: number
  frameP50: number
  frameP95: number
  flushP50: number
  flushP95: number
  flushMax: number
  latencyP50: number
  latencyP95: number
  ticksPerFlushP50: number
  totals: PerfTotals
}

export type SamplingEnv = {
  requestFrame(callback: (time: number) => void): () => void
  observeLongTasks(onTask: (durationMs: number) => void): () => void
}

export class PerfMetrics {
  private readonly frames: RollingStat
  private readonly flush: RollingStat
  private readonly latency: RollingStat
  private readonly ticksPerFlush: RollingStat
  private flushes = 0
  private setDataFlushes = 0
  private longTasks = 0
  private longTaskMaxMs = 0
  private readonly commits = new Map<string, number>()
  private samplingRefs = 0
  private stopSampling: () => void = () => {}

  constructor(capacity: number) {
    this.frames = new RollingStat(capacity)
    this.flush = new RollingStat(capacity)
    this.latency = new RollingStat(capacity)
    this.ticksPerFlush = new RollingStat(capacity)
  }

  recordFrame(ms: number): void {
    this.frames.add(ms)
  }

  recordFlush(stats: FlushStats): void {
    this.flushes++
    if (stats.mode === 'setData') this.setDataFlushes++
    this.flush.add(stats.durationMs)
    this.latency.add(stats.latencyMs)
    this.ticksPerFlush.add(stats.ticks)
  }

  recordCommit(id: string): void {
    this.commits.set(id, (this.commits.get(id) ?? 0) + 1)
  }

  recordLongTask(ms: number): void {
    this.longTasks++
    this.longTaskMaxMs = Math.max(this.longTaskMaxMs, ms)
  }

  clearSamples(): void {
    this.frames.clear()
    this.flush.clear()
    this.latency.clear()
    this.ticksPerFlush.clear()
  }

  snapshot(): PerfSnapshot {
    const frameP50 = this.frames.percentile(0.5)
    return {
      fps: frameP50 > 0 ? Math.round(1_000 / frameP50) : 0,
      frameP50,
      frameP95: this.frames.percentile(0.95),
      flushP50: this.flush.percentile(0.5),
      flushP95: this.flush.percentile(0.95),
      flushMax: this.flush.max(),
      latencyP50: this.latency.percentile(0.5),
      latencyP95: this.latency.percentile(0.95),
      ticksPerFlushP50: this.ticksPerFlush.percentile(0.5),
      totals: {
        flushes: this.flushes,
        setDataFlushes: this.setDataFlushes,
        longTasks: this.longTasks,
        longTaskMaxMs: this.longTaskMaxMs,
        commits: Object.fromEntries(this.commits),
      },
    }
  }

  /** Starts the frame loop + long-task observer on first acquire; stops on last release. */
  acquireSampling(env: SamplingEnv): () => void {
    this.samplingRefs++
    if (this.samplingRefs === 1) this.stopSampling = this.startSampling(env)
    let released = false
    return () => {
      if (released) return
      released = true
      this.samplingRefs--
      if (this.samplingRefs === 0) this.stopSampling()
    }
  }

  private startSampling(env: SamplingEnv): () => void {
    let lastFrame: number | 'none' = 'none'
    let cancelFrame: () => void = () => {}
    const loop = (time: number): void => {
      if (lastFrame !== 'none') this.recordFrame(time - lastFrame)
      lastFrame = time
      cancelFrame = env.requestFrame(loop)
    }
    cancelFrame = env.requestFrame(loop)
    const stopObserver = env.observeLongTasks((ms) => this.recordLongTask(ms))
    return () => {
      cancelFrame()
      stopObserver()
    }
  }
}

export function browserSamplingEnv(): SamplingEnv {
  return {
    requestFrame(callback) {
      const handle = requestAnimationFrame(callback)
      return () => cancelAnimationFrame(handle)
    },
    observeLongTasks(onTask) {
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        return () => {}
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onTask(entry.duration)
      })
      observer.observe({ type: 'longtask' })
      return () => observer.disconnect()
    },
  }
}

/** App-wide collector (HUD, profiler callbacks, chart feeder, bench). */
export const perfMetrics = new PerfMetrics(PERF_SAMPLE_CAPACITY)
