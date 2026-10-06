import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerfMetrics } from '@/lib/perf/perf-metrics'
import {
  type SoakConfig,
  type SoakDeps,
  type SoakResult,
  type SoakSample,
  SOAK_CONFIG,
  SOAK_DURATION_MS,
  SOAK_SAMPLE_EVERY_MS,
  runSoak,
} from '@/lib/perf/soak'
import type { ClientStats, ConnectionStatus } from '@/lib/realtime/market-client'
import type { DevCommand } from '@/lib/realtime/protocol'

const ENVIRONMENT = {
  userAgent: 'test-agent',
  devicePixelRatio: 1,
  hardwareConcurrency: 4,
  buildHash: 'abc1234',
  cpuThrottleLabel: 'none',
} as const

/** 3.5 s window sampled every second: samples at 1, 2, 3 and 3.5 s (the last interval is partial). */
const SHORT: SoakConfig = { ...SOAK_CONFIG, warmupMs: 500, durationMs: 3_500, sampleEveryMs: 1_000 }

function fakeSoak(options: { heap?: () => number | 'n/a'; loaf?: boolean; isCancelled?: () => boolean } = {}) {
  const commands: DevCommand[] = []
  const samples: SoakSample[] = []
  const windows: { edge: 'start' | 'end'; at: number }[] = []
  const stats: ClientStats = { messages: 0, trades: 0, tradeItems: 0, bytes: 0, gaps: 0, resyncs: 0, duplicates: 0, reconnects: 0 }
  let status: ConnectionStatus = 'live'
  const metrics = new PerfMetrics(1_000)
  const release = metrics.acquireSampling({
    requestFrame: () => () => {},
    observeLongTasks: () => () => {},
    observeLongAnimationFrames: () => ({ supported: options.loaf ?? true, stop: () => {} }),
    observeEventTiming: () => ({ supported: false, stop: () => {} }),
  })
  const deps: SoakDeps = {
    target: {
      sendDev: (command) => commands.push(command),
      stats: () => stats,
      status: () => status,
    },
    environment: ENVIRONMENT,
    metrics,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    wallNow: () => Date.now() + 5_000_000,
    heapMb: options.heap ?? (() => 40),
    isCancelled: options.isCancelled ?? (() => false),
    onWindow: (edge) => windows.push({ edge, at: Date.now() }),
    onSample: (sample) => samples.push(sample),
  }
  return {
    deps,
    commands,
    samples,
    windows,
    stats,
    metrics,
    setStatus: (next: ConnectionStatus) => {
      status = next
    },
    release,
  }
}

async function soakOk(config: SoakConfig, fake: ReturnType<typeof fakeSoak>): Promise<SoakResult> {
  const promise = runSoak(config, fake.deps)
  await vi.advanceTimersByTimeAsync(60_000)
  fake.release()
  const result = await promise
  if (result === 'cancelled') throw new Error('unexpected cancel')
  return result
}

const START = 1_000_000

beforeEach(() => {
  vi.useFakeTimers({ now: START })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('soak config', () => {
  it('defaults to 30 min at 30 trades/s, compact, sampled every 60 s from a fixed seed', () => {
    expect(SOAK_DURATION_MS).toBe(30 * 60_000)
    expect(SOAK_SAMPLE_EVERY_MS).toBe(60_000)
    expect(SOAK_CONFIG).toMatchObject({
      tradesPerSec: 30,
      batchMs: 100,
      aggregation: 'compact',
      durationMs: SOAK_DURATION_MS,
      sampleEveryMs: SOAK_SAMPLE_EVERY_MS,
    })
    expect(typeof SOAK_CONFIG.seed).toBe('number')
  })
})

describe('runSoak', () => {
  it('applies the settings (seeded) and restores server defaults at the end', async () => {
    const fake = fakeSoak()
    const result = await soakOk(SHORT, fake)
    expect(fake.commands.slice(0, 6)).toEqual([
      { kind: 'set_rate', tradesPerSec: 30 },
      { kind: 'set_batch_interval', ms: 100 },
      { kind: 'set_latency', ms: 0 },
      { kind: 'set_drop_rate', rate: 0 },
      { kind: 'set_aggregation', mode: 'compact' },
      { kind: 'reset_market', seed: SOAK_CONFIG.seed },
    ])
    expect(fake.commands.slice(6).map((c) => c.kind)).toEqual([
      'set_rate',
      'set_batch_interval',
      'set_latency',
      'set_drop_rate',
      'set_aggregation',
    ])
    expect(result.seedApplied).toBe(true)
    expect(result.endedLive).toBe(true)
  })

  it('samples on schedule after warm-up, with the last interval cut at the duration', async () => {
    const fake = fakeSoak()
    const result = await soakOk(SHORT, fake)
    expect(fake.windows).toEqual([
      { edge: 'start', at: START + 500 },
      { edge: 'end', at: START + 4_000 },
    ])
    expect(result.samples.map((s) => [s.index, s.elapsedMs])).toEqual([
      [1, 1_000],
      [2, 2_000],
      [3, 3_000],
      [4, 3_500],
    ])
    expect(fake.samples).toEqual(result.samples)
    expect([result.durationSec, result.sampleEverySec, result.wallClockStartMs]).toEqual([3.5, 1, START + 500 + 5_000_000])
  })

  it('reports frame p95 and LoAF per minute per interval', async () => {
    const fake = fakeSoak()
    // Interval 1 (0.5–1.5 s): smooth frames, one LoAF. Interval 2: two 50 ms frames of 20, two LoAFs.
    setTimeout(() => {
      for (let i = 0; i < 20; i++) fake.metrics.recordFrame(16.67)
      fake.metrics.recordLongAnimationFrame({ durationMs: 80, blockingMs: 40 })
    }, 1_000)
    setTimeout(() => {
      for (let i = 0; i < 20; i++) fake.metrics.recordFrame(i < 2 ? 50 : 16.67)
      fake.metrics.recordLongAnimationFrame({ durationMs: 80, blockingMs: 40 })
      fake.metrics.recordLongAnimationFrame({ durationMs: 80, blockingMs: 40 })
    }, 2_000)
    const result = await soakOk(SHORT, fake)
    const [first, second, third, last] = result.samples
    expect([first.frameP95Ms, first.loafPerMin]).toEqual([16.67, 60])
    expect([second.frameP95Ms, second.pctFramesOverBudget, second.loafPerMin]).toEqual([50, 10, 120])
    expect([third.frameP95Ms, third.loafPerMin]).toEqual([0, 0])
    // Half-length last interval: per-minute rates use its real length.
    expect(last.loafPerMin).toBe(0)
    expect([result.frameP95MaxMs, result.loafPerMinMax]).toEqual([50, 120])
  })

  it('reports LoAF as n/a where the API is unsupported', async () => {
    const result = await soakOk(SHORT, fakeSoak({ loaf: false }))
    expect(result.samples.every((s) => s.loafPerMin === 'n/a')).toBe(true)
    expect(result.loafPerMinMax).toBe('n/a')
  })

  it('reports heap per sample and growth vs the first sample in MB and %', async () => {
    const fake = fakeSoak({ heap: () => 40 + (Date.now() - START - 1_500) / 1_000 })
    const result = await soakOk(SHORT, fake)
    expect(result.samples.map((s) => s.heapMb)).toEqual([40, 41, 42, 42.5])
    expect([result.heapFirstMb, result.heapLastMb, result.heapGrowthMb, result.heapGrowthPct]).toEqual([40, 42.5, 2.5, 6.25])
  })

  it('reports heap growth as n/a without performance.memory', async () => {
    const result = await soakOk(SHORT, fakeSoak({ heap: () => 'n/a' }))
    expect(result.samples.every((s) => s.heapMb === 'n/a')).toBe(true)
    expect([result.heapFirstMb, result.heapLastMb, result.heapGrowthMb, result.heapGrowthPct]).toEqual(['n/a', 'n/a', 'n/a', 'n/a'])
  })

  it('counts correctness counters per interval and in total, excluding warm-up', async () => {
    const fake = fakeSoak()
    // Warm-up: excluded.
    setTimeout(() => {
      fake.stats.gaps += 5
    }, 200)
    setTimeout(() => {
      fake.stats.gaps += 1
      fake.stats.resyncs += 1
    }, 1_200)
    setTimeout(() => {
      fake.stats.duplicates += 2
      fake.stats.reconnects += 1
      fake.setStatus('reconnecting')
    }, 3_800)
    const result = await soakOk(SHORT, fake)
    expect(result.samples.map((s) => s.counters)).toEqual([
      { gaps: 1, resyncs: 1, duplicates: 0, reconnects: 0 },
      { gaps: 0, resyncs: 0, duplicates: 0, reconnects: 0 },
      { gaps: 0, resyncs: 0, duplicates: 0, reconnects: 0 },
      { gaps: 0, resyncs: 0, duplicates: 2, reconnects: 1 },
    ])
    expect(result.totals).toEqual({ gaps: 1, resyncs: 1, duplicates: 2, reconnects: 1 })
    expect(result.samples.at(-1)?.status).toBe('reconnecting')
    expect(result.endedLive).toBe(false)
  })

  it('stores the environment with the seed and the measured display Hz', async () => {
    const fake = fakeSoak()
    const frames = setInterval(() => fake.metrics.recordFrame(16.67), 17)
    const result = await soakOk(SHORT, fake)
    clearInterval(frames)
    expect(result.environment).toEqual({ ...ENVIRONMENT, displayHz: 60, seed: SOAK_CONFIG.seed })
  })

  it('stops when cancelled and still restores defaults', async () => {
    let cancelled = false
    const fake = fakeSoak({ isCancelled: () => cancelled })
    setTimeout(() => {
      cancelled = true
    }, 1_700)
    const promise = runSoak(SHORT, fake.deps)
    await vi.advanceTimersByTimeAsync(60_000)
    fake.release()
    expect(await promise).toBe('cancelled')
    expect(fake.samples).toHaveLength(1)
    expect(fake.commands.at(-1)).toEqual({ kind: 'set_aggregation', mode: 'compact' })
    expect(fake.commands.filter((c) => c.kind === 'set_rate')).toHaveLength(2)
  })
})
