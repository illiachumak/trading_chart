// Collectors for the perf HUD and the benchmark. Percentiles are over a rolling window;
// totals are cumulative so several readers can compute their own rates from deltas.

import { FRAME_BUDGET_MS, INP_DURATION_THRESHOLD_MS, PERF_SAMPLE_CAPACITY } from '@/config/market'
import {
  type EventTimingSample,
  type InteractionSummary,
  estimateDisplayHz,
  groupInteractions,
  pctOverBudget,
  percentileOfSorted,
  summarizeInteractions,
} from '@/lib/perf/metrics-math'
import { RollingStat } from '@/lib/perf/rolling-stat'
import type { FlushStats } from '@/lib/realtime/chart-feeder'

const MAX_FRAME_GAP_MS = 1_000

export type PerfTotals = {
  flushes: number
  setDataFlushes: number
  longTasks: number
  longTaskMaxMs: number
  /** Long Animation Frames (stays 0 where the API is unsupported, see PerfSnapshot.loafSupported). */
  longAnimationFrames: number
  commits: Readonly<Record<string, number>>
}

export type PerfSnapshot = {
  /** Metadata only (1000 / median frame); judge smoothness by frame percentiles and pctFramesOverBudget. */
  fps: number
  frameP50: number
  frameP95: number
  frameP99: number
  /** Share of frames longer than FRAME_BUDGET_MS (60 Hz budget), in percent. */
  pctFramesOverBudget: number
  /** Refresh rate estimated from the median rAF delta; 'n/a' before any frame. */
  displayHz: number | 'n/a'
  flushP50: number
  flushP95: number
  flushMax: number
  /** Data age at paint (server now − oldest tick of a flush), see FlushStats.dataAgeMs. */
  dataAgeP50: number
  dataAgeP95: number
  ticksPerFlushP50: number
  /** Longest long task since the last clearSamples() (totals.longTaskMaxMs is all-time). */
  windowLongTaskMaxMs: number
  /** Whether the browser reports `long-animation-frame` entries (Chromium 123+). */
  loafSupported: boolean
  /** Longest LoAF `duration` / `blockingDuration` since the last clearSamples(). */
  windowLoafMaxMs: number
  windowLoafBlockingMaxMs: number
  /** Whether the browser reports Event Timing entries with `interactionId`. */
  inpSupported: boolean
  /** Interactions since the last clearSamples(): latency = longest event entry per interactionId. */
  interactions: InteractionSummary
  totals: PerfTotals
}

export type LongAnimationFrameSample = { durationMs: number; blockingMs: number }

/** A started PerformanceObserver; `supported` is false when the entry type is unavailable (stop is then a no-op). */
export type Observation = { supported: boolean; stop(): void }

export type SamplingEnv = {
  requestFrame(callback: (time: number) => void): () => void
  observeLongTasks(onTask: (durationMs: number) => void): () => void
  observeLongAnimationFrames(onFrame: (frame: LongAnimationFrameSample) => void): Observation
  observeEventTiming(onEntries: (entries: EventTimingSample[]) => void): Observation
}

export class PerfMetrics {
  private readonly capacity: number
  private readonly frames: RollingStat
  private readonly flush: RollingStat
  private readonly dataAge: RollingStat
  private readonly ticksPerFlush: RollingStat
  private flushes = 0
  private setDataFlushes = 0
  private longTasks = 0
  private longTaskMaxMs = 0
  private windowLongTaskMaxMs = 0
  private longAnimationFrames = 0
  private windowLoafMaxMs = 0
  private windowLoafBlockingMaxMs = 0
  private loafSupported = false
  private inpSupported = false
  /** interactionId → latency, for the current window. */
  private interactions = new Map<number, number>()
  private readonly commits = new Map<string, number>()
  private samplingRefs = 0
  private stopSampling: () => void = () => {}

  constructor(capacity: number) {
    this.capacity = capacity
    this.frames = new RollingStat(capacity)
    this.flush = new RollingStat(capacity)
    this.dataAge = new RollingStat(capacity)
    this.ticksPerFlush = new RollingStat(capacity)
  }

  recordFrame(ms: number): void {
    this.frames.add(ms)
  }

  recordFlush(stats: FlushStats): void {
    this.flushes++
    if (stats.mode === 'setData') this.setDataFlushes++
    this.flush.add(stats.durationMs)
    this.dataAge.add(stats.dataAgeMs)
    this.ticksPerFlush.add(stats.ticks)
  }

  recordCommit(id: string): void {
    this.commits.set(id, (this.commits.get(id) ?? 0) + 1)
  }

  recordLongTask(ms: number): void {
    this.longTasks++
    this.longTaskMaxMs = Math.max(this.longTaskMaxMs, ms)
    this.windowLongTaskMaxMs = Math.max(this.windowLongTaskMaxMs, ms)
  }

  recordLongAnimationFrame(frame: LongAnimationFrameSample): void {
    this.longAnimationFrames++
    this.windowLoafMaxMs = Math.max(this.windowLoafMaxMs, frame.durationMs)
    this.windowLoafBlockingMaxMs = Math.max(this.windowLoafBlockingMaxMs, frame.blockingMs)
  }

  recordEventTiming(entries: readonly EventTimingSample[]): void {
    // Bounded like the rolling stats: new interactions beyond capacity are dropped until the next window.
    for (const entry of entries) {
      if (this.interactions.has(entry.interactionId) || this.interactions.size < this.capacity) {
        groupInteractions([entry], this.interactions)
      }
    }
  }

  clearSamples(): void {
    this.frames.clear()
    this.flush.clear()
    this.dataAge.clear()
    this.ticksPerFlush.clear()
    this.windowLongTaskMaxMs = 0
    this.windowLoafMaxMs = 0
    this.windowLoafBlockingMaxMs = 0
    this.interactions = new Map()
  }

  snapshot(): PerfSnapshot {
    const frames = this.frames.sorted()
    const frameP50 = percentileOfSorted(frames, 0.5)
    return {
      fps: frameP50 > 0 ? Math.round(1_000 / frameP50) : 0,
      frameP50,
      frameP95: percentileOfSorted(frames, 0.95),
      frameP99: percentileOfSorted(frames, 0.99),
      pctFramesOverBudget: pctOverBudget(frames, FRAME_BUDGET_MS),
      displayHz: estimateDisplayHz(frameP50),
      flushP50: this.flush.percentile(0.5),
      flushP95: this.flush.percentile(0.95),
      flushMax: this.flush.max(),
      dataAgeP50: this.dataAge.percentile(0.5),
      dataAgeP95: this.dataAge.percentile(0.95),
      ticksPerFlushP50: this.ticksPerFlush.percentile(0.5),
      windowLongTaskMaxMs: this.windowLongTaskMaxMs,
      loafSupported: this.loafSupported,
      windowLoafMaxMs: this.windowLoafMaxMs,
      windowLoafBlockingMaxMs: this.windowLoafBlockingMaxMs,
      inpSupported: this.inpSupported,
      interactions: summarizeInteractions(this.interactions.values()),
      totals: {
        flushes: this.flushes,
        setDataFlushes: this.setDataFlushes,
        longTasks: this.longTasks,
        longTaskMaxMs: this.longTaskMaxMs,
        longAnimationFrames: this.longAnimationFrames,
        commits: Object.fromEntries(this.commits),
      },
    }
  }

  /** Starts the frame loop + performance observers on first acquire; stops on last release. */
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
      // Gaps this long mean the tab was hidden or throttled, not a slow frame.
      if (lastFrame !== 'none' && time - lastFrame <= MAX_FRAME_GAP_MS) this.recordFrame(time - lastFrame)
      lastFrame = time
      cancelFrame = env.requestFrame(loop)
    }
    cancelFrame = env.requestFrame(loop)
    const stopLongTasks = env.observeLongTasks((ms) => this.recordLongTask(ms))
    const loaf = env.observeLongAnimationFrames((frame) => this.recordLongAnimationFrame(frame))
    const events = env.observeEventTiming((entries) => this.recordEventTiming(entries))
    this.loafSupported = loaf.supported
    this.inpSupported = events.supported
    return () => {
      cancelFrame()
      stopLongTasks()
      loaf.stop()
      events.stop()
    }
  }
}

const UNSUPPORTED: Observation = { supported: false, stop: () => {} }

/** Starts a PerformanceObserver for `init.type` if the browser supports that entry type. */
function observeEntries(init: PerformanceObserverInit & { type: string }, onList: (entries: PerformanceEntryList) => void): Observation {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !Array.isArray(PerformanceObserver.supportedEntryTypes) ||
    !PerformanceObserver.supportedEntryTypes.includes(init.type)
  ) {
    return UNSUPPORTED
  }
  try {
    const observer = new PerformanceObserver((list) => onList(list.getEntries()))
    observer.observe(init)
    return { supported: true, stop: () => observer.disconnect() }
  } catch {
    return UNSUPPORTED
  }
}

export function browserSamplingEnv(): SamplingEnv {
  return {
    requestFrame(callback) {
      const handle = requestAnimationFrame(callback)
      return () => cancelAnimationFrame(handle)
    },
    observeLongTasks(onTask) {
      return observeEntries({ type: 'longtask' }, (entries) => {
        for (const entry of entries) onTask(entry.duration)
      }).stop
    },
    observeLongAnimationFrames(onFrame) {
      return observeEntries({ type: 'long-animation-frame' }, (entries) => {
        for (const entry of entries) {
          const blockingMs = 'blockingDuration' in entry && typeof entry.blockingDuration === 'number' ? entry.blockingDuration : 0
          onFrame({ durationMs: entry.duration, blockingMs })
        }
      })
    },
    observeEventTiming(onEntries) {
      // `durationThreshold` is missing from TS's PerformanceObserverInit; a non-literal skips the excess-property check.
      const init = { type: 'event', durationThreshold: INP_DURATION_THRESHOLD_MS }
      return observeEntries(init, (entries) => {
        const samples: EventTimingSample[] = []
        for (const entry of entries) {
          if ('interactionId' in entry && typeof entry.interactionId === 'number') {
            samples.push({ interactionId: entry.interactionId, durationMs: entry.duration })
          }
        }
        if (samples.length > 0) onEntries(samples)
      })
    },
  }
}

/** App-wide collector (HUD, profiler callbacks, chart feeder, bench). */
export const perfMetrics = new PerfMetrics(PERF_SAMPLE_CAPACITY)
