// Long-run soak: one steady setting for a long window, sampled at a fixed interval to spot leaks
// (heap growth) and slow degradation (frame p95, LoAF per minute, correctness counters).
// Pure — the browser wiring is in useBench; time and sleep are injected like runBench.

import { BATCH_INTERVAL_MS } from '@/config/market'
import {
  type BenchDeps,
  type BenchEnvironment,
  type BenchTarget,
  applySettings,
  restoreDefaults,
  round2,
} from '@/lib/perf/bench'
import type { ClientStats, ConnectionStatus } from '@/lib/realtime/market-client'
import type { AggregationMode } from '@/lib/realtime/protocol'

export const SOAK_DURATION_MS = 30 * 60_000
export const SOAK_SAMPLE_EVERY_MS = 60_000
/** Fixed so every soak replays the same arrivals and sizes. */
export const SOAK_SEED = 30_303

const MS_PER_MIN = 60_000
/** Longest single sleep, so a cancel (e.g. leaving the page) is noticed within a second. */
export const SOAK_SLEEP_STEP_MS = 1_000

export type SoakConfig = {
  name: string
  tradesPerSec: number
  batchMs: number
  aggregation: AggregationMode
  seed: number
  warmupMs: number
  durationMs: number
  sampleEveryMs: number
}

export const SOAK_CONFIG: SoakConfig = {
  name: 'soak 30/s',
  tradesPerSec: 30,
  batchMs: BATCH_INTERVAL_MS,
  aggregation: 'compact',
  seed: SOAK_SEED,
  warmupMs: 2_000,
  durationMs: SOAK_DURATION_MS,
  sampleEveryMs: SOAK_SAMPLE_EVERY_MS,
}

export type SoakCounters = Pick<ClientStats, 'gaps' | 'resyncs' | 'duplicates' | 'reconnects'>

export type SoakSample = {
  /** 1-based sample number. */
  index: number
  /** Since the window start (after warm-up). */
  elapsedMs: number
  /** `performance.memory` heap at the sample; 'n/a' outside Chromium. */
  heapMb: number | 'n/a'
  /** Over this interval (the rolling frame window holds the last PERF_SAMPLE_CAPACITY frames of it). */
  frameP95Ms: number
  pctFramesOverBudget: number
  /** Long Animation Frames per minute of this interval; 'n/a' where the API is unsupported. */
  loafPerMin: number | 'n/a'
  status: ConnectionStatus
  /** Counter increments during this interval. */
  counters: SoakCounters
}

export type SoakResult = {
  name: string
  tradesPerSec: number
  batchMs: number
  aggregation: AggregationMode
  seed: number
  /** The market was reset from `seed` (sent while live). */
  seedApplied: boolean
  durationSec: number
  sampleEverySec: number
  /** Date.now() at window start. */
  wallClockStartMs: number
  samples: SoakSample[]
  heapFirstMb: number | 'n/a'
  heapLastMb: number | 'n/a'
  /** Last sample − first sample (the first sample, not the window start, so warm-up allocations don't count). */
  heapGrowthMb: number | 'n/a'
  heapGrowthPct: number | 'n/a'
  frameP95MaxMs: number
  loafPerMinMax: number | 'n/a'
  totals: SoakCounters
  endedLive: boolean
  environment: BenchEnvironment
}

export type SoakDeps = Pick<BenchDeps, 'environment' | 'metrics' | 'sleep' | 'now' | 'wallNow' | 'heapMb' | 'isCancelled'> & {
  target: Pick<BenchTarget, 'sendDev' | 'stats' | 'status'>
  onWindow(edge: 'start' | 'end'): void
  onSample(sample: SoakSample, total: number): void
}

/** Runs the soak; the server's settings are restored to defaults however it ends (done, cancelled or thrown). */
export async function runSoak(config: SoakConfig, deps: SoakDeps): Promise<SoakResult | 'cancelled'> {
  try {
    return await soak(config, deps)
  } finally {
    restoreDefaults(deps.target)
  }
}

function counters(stats: ClientStats): SoakCounters {
  return { gaps: stats.gaps, resyncs: stats.resyncs, duplicates: stats.duplicates, reconnects: stats.reconnects }
}

function counterDelta(end: SoakCounters, start: SoakCounters): SoakCounters {
  return {
    gaps: end.gaps - start.gaps,
    resyncs: end.resyncs - start.resyncs,
    duplicates: end.duplicates - start.duplicates,
    reconnects: end.reconnects - start.reconnects,
  }
}

function heapGrowth(samples: readonly SoakSample[]): Pick<SoakResult, 'heapFirstMb' | 'heapLastMb' | 'heapGrowthMb' | 'heapGrowthPct'> {
  const first = samples.length > 0 ? samples[0].heapMb : 'n/a'
  const last = samples.length > 0 ? samples[samples.length - 1].heapMb : 'n/a'
  if (first === 'n/a' || last === 'n/a') return { heapFirstMb: first, heapLastMb: last, heapGrowthMb: 'n/a', heapGrowthPct: 'n/a' }
  return {
    heapFirstMb: first,
    heapLastMb: last,
    heapGrowthMb: round2(last - first),
    heapGrowthPct: first > 0 ? round2(((last - first) / first) * 100) : 'n/a',
  }
}

function maxLoafPerMin(samples: readonly SoakSample[]): number | 'n/a' {
  let max: number | 'n/a' = 'n/a'
  for (const sample of samples) {
    if (sample.loafPerMin !== 'n/a') max = max === 'n/a' ? sample.loafPerMin : Math.max(max, sample.loafPerMin)
  }
  return max
}

/** Sleeps `ms` in steps of at most SOAK_SLEEP_STEP_MS; 'cancelled' as soon as a step ends with a cancel. */
async function sleepUnlessCancelled(ms: number, deps: Pick<SoakDeps, 'sleep' | 'isCancelled'>): Promise<'slept' | 'cancelled'> {
  // Counts down by the requested steps (not the clock): step overshoot is absorbed by the caller's
  // window-anchored schedule, and a fake sleep that resolves instantly can't loop forever.
  for (let left = ms; left > 0; left -= SOAK_SLEEP_STEP_MS) {
    await deps.sleep(Math.min(left, SOAK_SLEEP_STEP_MS))
    if (deps.isCancelled()) return 'cancelled'
  }
  return deps.isCancelled() ? 'cancelled' : 'slept'
}

async function soak(config: SoakConfig, deps: SoakDeps): Promise<SoakResult | 'cancelled'> {
  const seedApplied = await applySettings({ ...config, latencyMs: 0, dropRate: 0, probe: 'off' }, deps)
  if ((await sleepUnlessCancelled(config.warmupMs, deps)) === 'cancelled') return 'cancelled'

  const total = Math.ceil(config.durationMs / config.sampleEveryMs)
  const samples: SoakSample[] = []
  const startCounters = counters(deps.target.stats())
  let prevCounters = startCounters
  let prevLoaf = deps.metrics.snapshot().totals.longAnimationFrames
  deps.metrics.clearSamples()
  const startedAt = deps.now()
  const wallClockStartMs = deps.wallNow()
  let prevAt = startedAt
  let displayHz: number | 'n/a' = 'n/a'
  deps.onWindow('start')

  for (let index = 1; index <= total; index++) {
    // Scheduled from the window start, so sleep overshoot doesn't accumulate.
    const waitMs = startedAt + Math.min(index * config.sampleEveryMs, config.durationMs) - deps.now()
    if ((await sleepUnlessCancelled(waitMs, deps)) === 'cancelled') return 'cancelled'

    const at = deps.now()
    const snap = deps.metrics.snapshot()
    const nowCounters = counters(deps.target.stats())
    const intervalMs = at - prevAt
    const loaf = snap.totals.longAnimationFrames - prevLoaf
    const sample: SoakSample = {
      index,
      elapsedMs: round2(at - startedAt),
      heapMb: deps.heapMb(),
      frameP95Ms: round2(snap.frameP95),
      pctFramesOverBudget: round2(snap.pctFramesOverBudget),
      loafPerMin: snap.loafSupported && intervalMs > 0 ? round2((loaf / intervalMs) * MS_PER_MIN) : 'n/a',
      status: deps.target.status(),
      counters: counterDelta(nowCounters, prevCounters),
    }
    if (snap.displayHz !== 'n/a') displayHz = snap.displayHz
    deps.metrics.clearSamples()
    prevAt = at
    prevCounters = nowCounters
    prevLoaf = snap.totals.longAnimationFrames
    samples.push(sample)
    deps.onSample(sample, total)
  }
  deps.onWindow('end')

  return {
    name: config.name,
    tradesPerSec: config.tradesPerSec,
    batchMs: config.batchMs,
    aggregation: config.aggregation,
    seed: config.seed,
    seedApplied,
    durationSec: round2((prevAt - startedAt) / 1_000),
    sampleEverySec: round2(config.sampleEveryMs / 1_000),
    wallClockStartMs,
    samples,
    ...heapGrowth(samples),
    frameP95MaxMs: samples.reduce((max, s) => Math.max(max, s.frameP95Ms), 0),
    loafPerMinMax: maxLoafPerMin(samples),
    totals: counterDelta(prevCounters, startCounters),
    endedLive: deps.target.status() === 'live',
    environment: { ...deps.environment, displayHz, seed: config.seed },
  }
}
