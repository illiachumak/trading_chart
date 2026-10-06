// Scripted benchmark: drives the mock backend through a parameter matrix (trade rate ×
// batch interval × slippage × faults), optionally probes order fills, and samples the
// same collectors the HUD uses. Pure — the browser wiring is in useBench.

import { BATCH_INTERVAL_MS, DEFAULT_AGGREGATION, DEFAULT_TRADES_PER_SEC } from '@/config/market'
import { type RecoveryTimeline, type StatusSample, percentileOfSorted, recoveryTimes } from '@/lib/perf/metrics-math'
import type { PerfMetrics, PerfSnapshot } from '@/lib/perf/perf-metrics'
import { ratesPerSecond } from '@/lib/perf/rates'
import type { ClientStats, ConnectionStatus } from '@/lib/realtime/market-client'
import type {
  AggregationMode,
  DevCommand,
  OrderResult,
  QuoteResult,
  RejectReason,
  Side,
} from '@/lib/realtime/protocol'
import { isRecord } from '@/lib/utils/is-record'

export type ProbeConfig = { slippage: number; amountUsd: number; everyMs: number; quoteAgeMs: number }

/** 'stress' = a limit run past the realistic range (reported, not tracked against a budget). */
export type BenchGroup = 'load' | 'batch' | 'slippage' | 'faults' | 'stress'

export type BenchPhase = {
  name: string
  group: BenchGroup
  tradesPerSec: number
  batchMs: number
  durationMs: number
  disconnects: number
  latencyMs: number
  dropRate: number
  aggregation: AggregationMode
  probe: ProbeConfig | 'off'
  /**
   * A number resets the market from this seed at phase start (before warm-up), so every run sees
   * the same trade sequence for the same rate; 'live' keeps whatever market is running.
   */
  seed: number | 'live'
}

export type BenchScenario = { phases: readonly BenchPhase[]; warmupMs: number }

export type ProbeResult = {
  /** Orders sent. */
  orders: number
  /** Filled or partially filled. */
  filled: number
  rejected: Record<RejectReason, number>
  /** No result within the order timeout. */
  timeouts: number
  /** Probe ticks that placed no order: quote timed out / unavailable, quote from a round that ended before the order, or no round yet. */
  skipped: number
  /** Fill-rate denominator: filled + slippage rejects (the only outcomes the tolerance decides). */
  n: number
  /** filled / n; 0 when n is 0. round_closed, timeouts etc. are reported separately, not counted here. */
  fillRate: number
  /** (fill avg − quoted avg) × 100, over filled orders; zeros when nothing filled. */
  realizedSlippageCents: { p50: number; p95: number; max: number }
}

export type OrderProbeRequest = {
  side: Side
  amountUsd: number
  expectedPrice: number
  maxSlippage: number
  /** Round the quote was taken in. */
  roundId: number
}

/** Cumulative worker tick timing (a `server_stats` payload); `tickMsMax` is since the previous report. */
export type ServerTickStats = { tickCount: number; tickMsTotal: number; tickMsMax: number }

/** A probe quote together with the round that was current when it was requested. */
export type ProbeQuote = { quote: QuoteResult; roundId: number }

export type BenchTarget = {
  sendDev(command: DevCommand): void
  stats(): ClientStats
  status(): ConnectionStatus
  /** Subscribes to client status changes (recovery timeline); returns unsubscribe. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  /** Asks the server for its tick stats; 'timeout' after 1 s (e.g. while disconnected). */
  serverStats(): Promise<ServerTickStats | 'timeout'>
  /** Fresh quote for (side, amount); resolves 'timeout' after 2 s, 'no_round' before the first round. */
  quote(side: Side, amountUsd: number): Promise<ProbeQuote | 'timeout' | 'no_round'>
  /** Id of the current round, or 'none' before the first one. */
  roundId(): number | 'none'
  /** Places an order and resolves with its result; 'timeout' after 3 s, 'no_round' before the first round. */
  placeOrder(request: OrderProbeRequest): Promise<OrderResult | 'timeout' | 'no_round'>
}

/** Run-level environment, the same for every phase of a run. */
export type BenchRunEnvironment = {
  userAgent: string
  devicePixelRatio: number
  hardwareConcurrency: number
  /** Short git hash baked in at build time; 'unknown' when git was unavailable. */
  buildHash: string
  /** Free-text label from the URL `&cpu=` (e.g. '4x', 'pixel7'); metadata only, nothing is throttled. 'none' when absent. */
  cpuThrottleLabel: string
}

/** Environment metadata stored with every phase result: run-level fields + what the window measured. */
export type BenchEnvironment = BenchRunEnvironment & { displayHz: number | 'n/a'; seed: number | 'live' }

export type BenchDeps = {
  target: BenchTarget
  environment: BenchRunEnvironment
  metrics: PerfMetrics
  sleep(ms: number): Promise<void>
  /** Monotonic clock (performance.now in the browser). */
  now(): number
  /** Wall clock (Date.now) — anchors the window for external samplers. */
  wallNow(): number
  heapMb(): number | 'n/a'
  isCancelled(): boolean
  /** Phase starts (warm-up begins). */
  onPhase(phase: BenchPhase, index: number): void
  /** Measured window edges: 'start' right after baselines, 'end' right at capture. */
  onWindow(phase: BenchPhase, edge: 'start' | 'end'): void
}

export type BenchPhaseResult = {
  phase: string
  group: BenchGroup
  tradesPerSec: number
  batchMs: number
  latencyMs: number
  dropRate: number
  aggregation: AggregationMode
  seed: number | 'live'
  /** The market was reset from `seed` (sent while live); false for 'live' phases or when the connection never came back. */
  seedApplied: boolean
  durationSec: number
  /** Measured window in `now()` time (performance.now in the browser). */
  windowStartMs: number
  windowEndMs: number
  /** Date.now() at window start. */
  wallClockStartMs: number
  /** Metadata only (1000 / median frame); compare runs by frame percentiles and pctFramesOverBudget. */
  fps: number
  frameP50Ms: number
  frameP95Ms: number
  frameP99Ms: number
  /** % of frames longer than FRAME_MISS_THRESHOLD_MS (1.5 x the 60 Hz budget, ~25 ms). */
  pctFramesOverBudget: number
  displayHz: number | 'n/a'
  flushP50Ms: number
  flushP95Ms: number
  flushMaxMs: number
  /** Data age at paint: server now − oldest tick of each chart flush (replaces the v2 newest-tick latencyP50Ms/P95Ms). */
  dataAgeP50Ms: number
  dataAgeP95Ms: number
  ticksPerFlushP50: number
  receivedMessagesPerSec: number
  /** All trades the server reported (shipped + aggregated). Below `tradesPerSec` = the pipeline can't keep up. */
  receivedTradesPerSec: number
  /** Trades shipped as items (equals receivedTradesPerSec in full mode). */
  receivedItemsPerSec: number
  /** Raw message characters per second / 1024 (~KB/s for ASCII JSON). */
  receivedKBPerSec: number
  commitsPerSecTotal: number
  commitsPerSec: Record<string, number>
  longTasks: number
  /** Longest long task inside the measured window. */
  longTaskMaxMs: number
  /** Long Animation Frames per minute of window; 'n/a' where the API is unsupported (non-Chromium). */
  loafPerMin: number | 'n/a'
  loafMaxMs: number | 'n/a'
  loafBlockingMaxMs: number | 'n/a'
  /** INP-style: interactions in the window (Event Timing, ≥16 ms entries only) and their p75 / max latency. */
  interactions: number
  inpP75Ms: number | 'n/a'
  inpMaxMs: number | 'n/a'
  /** Worker `tick()` calls per second; below 1000 / batchMs = the worker can't keep its batch interval. */
  serverTicksPerSec: number | 'n/a'
  serverTickMsAvg: number | 'n/a'
  /** Longest single tick inside the window. */
  serverTickMsMax: number | 'n/a'
  heapMb: number | 'n/a'
  gaps: number
  resyncs: number
  duplicates: number
  reconnects: number
  /** Outages (status left `live`) that started in the window and recovered by the end of settle. */
  recoveries: number
  /** Disconnect → live, per outage; 'n/a' without outages. */
  recoveryP50Ms: number | 'n/a'
  recoveryMaxMs: number | 'n/a'
  /** Outages still open when the settle wait gave up. */
  unrecovered: number
  endedLive: boolean
  probeConfig: ProbeConfig | 'off'
  probe: ProbeResult | 'off'
  environment: BenchEnvironment
}

// --- Scenarios (see the "Experiment design" table in the PR 4 v2 plan) ---

const MATRIX_PHASE_MS = 12_000
const QUICK_PHASE_MS = 4_000
const PROBE_AMOUNT_USD = 5
const PROBE_EVERY_MS = 1_000
const PROBE_START_BALANCE_USD = 1_000
const DEEP_PROBE_EVERY_MS = 300
const DEEP_SLIPPAGE_MS = 20_000
const DEEP_BATCH_MS = 15_000

const phase = (fields: Partial<BenchPhase> & Pick<BenchPhase, 'name' | 'group' | 'tradesPerSec'>): BenchPhase => ({
  batchMs: BATCH_INTERVAL_MS,
  durationMs: MATRIX_PHASE_MS,
  disconnects: 0,
  latencyMs: 0,
  dropRate: 0,
  // The published v2 numbers were measured with every trade shipped; keep these scenarios reproducible.
  aggregation: 'full',
  probe: 'off',
  seed: 'live',
  ...fields,
})

const LOAD_RATES = [5, 30, 100, 300, 500, 1_000] as const
const SWEEP_RATES = [100, 500] as const
const BATCH_SWEEP_MS = [16, 33, 50, 100, 250] as const
/** 1¢ is below the UI minimum but valid server-side — a deliberate data point. */
const SLIPPAGE_SWEEP = [0.01, 0.03, 0.05, 0.1] as const
const QUOTE_AGES_MS = [0, 1_000] as const

const MATRIX_PHASES: readonly BenchPhase[] = [
  ...LOAD_RATES.map((rate) => phase({ name: `load ${rate}/s`, group: 'load', tradesPerSec: rate })),
  ...SWEEP_RATES.flatMap((rate) =>
    BATCH_SWEEP_MS.map((ms) => phase({ name: `batch ${ms}ms @${rate}/s`, group: 'batch', tradesPerSec: rate, batchMs: ms })),
  ),
  ...SWEEP_RATES.flatMap((rate) =>
    SLIPPAGE_SWEEP.flatMap((slippage) =>
      QUOTE_AGES_MS.map((quoteAgeMs) =>
        phase({
          name: `slip ${Math.round(slippage * 100)}¢ age ${quoteAgeMs}ms @${rate}/s`,
          group: 'slippage',
          tradesPerSec: rate,
          probe: { slippage, amountUsd: PROBE_AMOUNT_USD, everyMs: PROBE_EVERY_MS, quoteAgeMs },
        }),
      ),
    ),
  ),
  phase({ name: 'faults 3 disconnects @100/s', group: 'faults', tradesPerSec: 100, disconnects: 3 }),
  phase({ name: 'faults drop 10% + 200ms @100/s', group: 'faults', tradesPerSec: 100, dropRate: 0.1, latencyMs: 200 }),
]

export const MATRIX_SCENARIO: BenchScenario = { phases: MATRIX_PHASES, warmupMs: 2_000 }

export const QUICK_SCENARIO: BenchScenario = {
  phases: MATRIX_PHASES.map((p) => ({ ...p, durationMs: QUICK_PHASE_MS })),
  warmupMs: 1_000,
}

const DEEP_RATES = [100, 500, 1_000] as const
const DEEP_QUOTE_AGES_MS = [0, 250, 1_000] as const

const DEEP_PHASES: readonly BenchPhase[] = [
  ...DEEP_RATES.flatMap((rate) =>
    SLIPPAGE_SWEEP.flatMap((slippage) =>
      DEEP_QUOTE_AGES_MS.map((quoteAgeMs) =>
        phase({
          name: `slip ${Math.round(slippage * 100)}¢ age ${quoteAgeMs}ms @${rate}/s`,
          group: 'slippage',
          tradesPerSec: rate,
          durationMs: DEEP_SLIPPAGE_MS,
          probe: { slippage, amountUsd: PROBE_AMOUNT_USD, everyMs: DEEP_PROBE_EVERY_MS, quoteAgeMs },
        }),
      ),
    ),
  ),
  ...BATCH_SWEEP_MS.map((ms) =>
    phase({ name: `batch ${ms}ms @500/s`, group: 'batch', tradesPerSec: 500, batchMs: ms, durationMs: DEEP_BATCH_MS }),
  ),
]

export const DEEP_SCENARIO: BenchScenario = { phases: DEEP_PHASES, warmupMs: 2_000 }

const SCALE_PHASE_MS = 12_000
const SCALE_LOAD_RATES = [1_000, 2_000, 5_000, 10_000] as const
const SCALE_BATCH_RATE = 5_000
// The 100 ms points of the batch sweeps are the 5,000/s load phases (same settings, same name), so they are not repeated.
const SCALE_BATCH_COMPACT_MS = [4, 8, 16, 33] as const
const SCALE_BATCH_FULL_MS = [16] as const

const scalePhase = (group: BenchGroup, tradesPerSec: number, aggregation: AggregationMode, batchMs: number): BenchPhase =>
  phase({ name: `scale ${tradesPerSec}/s ${aggregation} b${batchMs}`, group, tradesPerSec, aggregation, batchMs, durationMs: SCALE_PHASE_MS })

const SCALE_PHASES: readonly BenchPhase[] = [
  ...SCALE_LOAD_RATES.flatMap((rate) =>
    (['full', 'compact'] as const).map((mode) => scalePhase('load', rate, mode, BATCH_INTERVAL_MS)),
  ),
  ...SCALE_BATCH_COMPACT_MS.map((ms) => scalePhase('batch', SCALE_BATCH_RATE, 'compact', ms)),
  ...SCALE_BATCH_FULL_MS.map((ms) => scalePhase('batch', SCALE_BATCH_RATE, 'full', ms)),
]

export const SCALE_SCENARIO: BenchScenario = { phases: SCALE_PHASES, warmupMs: 2_000 }

// --- Realistic scenario (the tracked set, with soak): server defaults (compact, 100 ms), fixed seeds ---

const REALISTIC_PHASE_MS = 12_000
const REALISTIC_BURST_MS = 30_000
const REALISTIC_SLIPPAGE_MS = 20_000
const REALISTIC_PROBE_EVERY_MS = 300
const REALISTIC_QUOTE_AGE_MS = 250
const REALISTIC_SLIPPAGE_RATES = [30, 100, 300] as const
/** One-way latency injected by set_latency. */
const REALISTIC_LATENCIES_MS = [0, 150] as const

/**
 * Fixed seeds, the same on every run. Slippage phases share one seed per rate so every tolerance
 * and latency at that rate sees the same arrivals and sizes; only the probe settings differ.
 */
export const REALISTIC_SEEDS = {
  steady30: 30_001,
  steady300: 300_001,
  burst1000: 1_000_001,
  stress5000: 5_000_001,
  disconnects: 100_001,
  dropLatency: 100_002,
  slippage: { 30: 30_101, 100: 100_101, 300: 300_101 },
} as const

const realisticPhase = (fields: Partial<BenchPhase> & Pick<BenchPhase, 'name' | 'group' | 'tradesPerSec' | 'seed'>): BenchPhase =>
  phase({ aggregation: 'compact', durationMs: REALISTIC_PHASE_MS, ...fields })

const REALISTIC_PHASES: readonly BenchPhase[] = [
  realisticPhase({ name: 'steady 30/s', group: 'load', tradesPerSec: 30, seed: REALISTIC_SEEDS.steady30 }),
  realisticPhase({ name: 'steady 300/s', group: 'load', tradesPerSec: 300, seed: REALISTIC_SEEDS.steady300 }),
  realisticPhase({
    name: 'burst 1000/s',
    group: 'load',
    tradesPerSec: 1_000,
    durationMs: REALISTIC_BURST_MS,
    seed: REALISTIC_SEEDS.burst1000,
  }),
  realisticPhase({ name: 'stress 5000/s (limit)', group: 'stress', tradesPerSec: 5_000, seed: REALISTIC_SEEDS.stress5000 }),
  realisticPhase({
    name: 'faults 3 disconnects @100/s',
    group: 'faults',
    tradesPerSec: 100,
    disconnects: 3,
    seed: REALISTIC_SEEDS.disconnects,
  }),
  realisticPhase({
    name: 'faults drop 10% + 200ms @100/s',
    group: 'faults',
    tradesPerSec: 100,
    dropRate: 0.1,
    latencyMs: 200,
    seed: REALISTIC_SEEDS.dropLatency,
  }),
  ...SLIPPAGE_SWEEP.flatMap((slippage) =>
    REALISTIC_SLIPPAGE_RATES.flatMap((rate) =>
      REALISTIC_LATENCIES_MS.map((latencyMs) =>
        realisticPhase({
          name: `slip ${Math.round(slippage * 100)}¢ lat ${latencyMs}ms @${rate}/s`,
          group: 'slippage',
          tradesPerSec: rate,
          latencyMs,
          durationMs: REALISTIC_SLIPPAGE_MS,
          seed: REALISTIC_SEEDS.slippage[rate],
          probe: {
            slippage,
            amountUsd: PROBE_AMOUNT_USD,
            everyMs: REALISTIC_PROBE_EVERY_MS,
            quoteAgeMs: REALISTIC_QUOTE_AGE_MS,
          },
        }),
      ),
    ),
  ),
]

export const REALISTIC_SCENARIO: BenchScenario = { phases: REALISTIC_PHASES, warmupMs: 2_000 }

// --- Helpers ---

const LIVE_POLL_MS = 100
const LIVE_TIMEOUT_MS = 5_000
const BYTES_PER_KB = 1_024
const BYTES_PER_MB = 1_048_576

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

const MAX_CPU_LABEL_LENGTH = 32

/** `&cpu=` label from a query string (metadata only: says how the tester throttled the CPU); 'none' when absent. */
export function readCpuThrottleLabel(search: string): string {
  const label = (new URLSearchParams(search).get('cpu') ?? '').trim().slice(0, MAX_CPU_LABEL_LENGTH)
  return label === '' ? 'none' : label
}

/** Chrome-only `performance.memory.usedJSHeapSize`, in MB. */
export function readHeapMb(perf: unknown): number | 'n/a' {
  if (!isRecord(perf) || !isRecord(perf.memory)) return 'n/a'
  const used = perf.memory.usedJSHeapSize
  return typeof used === 'number' && Number.isFinite(used) ? round2(used / BYTES_PER_MB) : 'n/a'
}

function optionalRound2(value: number | 'n/a'): number | 'n/a' {
  return value === 'n/a' ? value : round2(value)
}

const MS_PER_MIN = 60_000

function loafWindow(
  snap: PerfSnapshot,
  count: number,
  elapsedMs: number,
): Pick<BenchPhaseResult, 'loafPerMin' | 'loafMaxMs' | 'loafBlockingMaxMs'> {
  if (!snap.loafSupported || elapsedMs <= 0) return { loafPerMin: 'n/a', loafMaxMs: 'n/a', loafBlockingMaxMs: 'n/a' }
  return {
    loafPerMin: round2((count / elapsedMs) * MS_PER_MIN),
    loafMaxMs: round2(snap.windowLoafMaxMs),
    loafBlockingMaxMs: round2(snap.windowLoafBlockingMaxMs),
  }
}

function recoverySummary(
  timeline: RecoveryTimeline,
): Pick<BenchPhaseResult, 'recoveries' | 'recoveryP50Ms' | 'recoveryMaxMs' | 'unrecovered'> {
  const sorted = [...timeline.recoveredMs].sort((a, b) => a - b)
  return {
    recoveries: sorted.length,
    recoveryP50Ms: sorted.length > 0 ? round2(percentileOfSorted(sorted, 0.5)) : 'n/a',
    recoveryMaxMs: sorted.length > 0 ? round2(sorted[sorted.length - 1]) : 'n/a',
    unrecovered: timeline.unrecovered,
  }
}

type ServerTickWindow = Pick<BenchPhaseResult, 'serverTicksPerSec' | 'serverTickMsAvg' | 'serverTickMsMax'>

function serverTickWindow(
  start: ServerTickStats | 'timeout',
  end: ServerTickStats | 'timeout',
  elapsedMs: number,
): ServerTickWindow {
  if (start === 'timeout' || end === 'timeout' || elapsedMs <= 0) {
    return { serverTicksPerSec: 'n/a', serverTickMsAvg: 'n/a', serverTickMsMax: 'n/a' }
  }
  const ticks = end.tickCount - start.tickCount
  return {
    serverTicksPerSec: round2(ticks / (elapsedMs / 1_000)),
    serverTickMsAvg: ticks > 0 ? round2((end.tickMsTotal - start.tickMsTotal) / ticks) : 0,
    // The start report resets the max, so the end report's max covers the window.
    serverTickMsMax: round2(end.tickMsMax),
  }
}

/** What the settings/wait-for-live helpers need; the soak runner shares them. */
export type SettingsDeps = { target: Pick<BenchTarget, 'sendDev' | 'status'>; sleep(ms: number): Promise<void> }

async function waitForLive(deps: SettingsDeps): Promise<boolean> {
  for (let waited = 0; waited < LIVE_TIMEOUT_MS; waited += LIVE_POLL_MS) {
    if (deps.target.status() === 'live') return true
    await deps.sleep(LIVE_POLL_MS)
  }
  return deps.target.status() === 'live'
}

function emptyRejects(): Record<RejectReason, number> {
  return { slippage: 0, round_closed: 0, insufficient_balance: 0, invalid: 0, price_limit: 0 }
}

type ProbeTally = {
  orders: number
  filled: number
  rejected: Record<RejectReason, number>
  timeouts: number
  skipped: number
  slippageCents: number[]
}

function summarizeProbe(tally: ProbeTally): ProbeResult {
  const sorted = [...tally.slippageCents].sort((a, b) => a - b)
  const n = tally.filled + tally.rejected.slippage
  return {
    orders: tally.orders,
    filled: tally.filled,
    rejected: tally.rejected,
    timeouts: tally.timeouts,
    skipped: tally.skipped,
    n,
    fillRate: n > 0 ? round2(tally.filled / n) : 0,
    realizedSlippageCents: {
      p50: round2(percentileOfSorted(sorted, 0.5)),
      p95: round2(percentileOfSorted(sorted, 0.95)),
      max: round2(sorted.length > 0 ? sorted[sorted.length - 1] : 0),
    },
  }
}

/**
 * Every `everyMs`: quote the next side, let the quote age, then order at the quoted price.
 * Runs until `shouldStop()`; an order already sent is awaited and still counted.
 */
async function runProbe(config: ProbeConfig, deps: BenchDeps, shouldStop: () => boolean): Promise<ProbeResult> {
  const tally: ProbeTally = { orders: 0, filled: 0, rejected: emptyRejects(), timeouts: 0, skipped: 0, slippageCents: [] }
  let side: Side = 'yes'
  while (!shouldStop()) {
    const startedAt = deps.now()
    const probeQuote = await deps.target.quote(side, config.amountUsd)
    if (probeQuote === 'timeout' || probeQuote === 'no_round' || probeQuote.quote.status !== 'ok') {
      tally.skipped++
    } else {
      const { quote, roundId } = probeQuote
      if (config.quoteAgeMs > 0) await deps.sleep(config.quoteAgeMs)
      if (shouldStop()) break
      // A quote from a finished round would only produce a round_closed reject; don't count it as an order.
      const result =
        deps.target.roundId() !== roundId
          ? 'no_round'
          : await deps.target.placeOrder({
              side,
              amountUsd: config.amountUsd,
              expectedPrice: quote.avgPrice,
              maxSlippage: config.slippage,
              roundId,
            })
      if (result === 'no_round') {
        tally.skipped++
      } else {
        tally.orders++
        if (result === 'timeout') tally.timeouts++
        else if (result.status === 'rejected') tally.rejected[result.reason]++
        else {
          tally.filled++
          tally.slippageCents.push((result.avgPrice - quote.avgPrice) * 100)
        }
      }
    }
    side = side === 'yes' ? 'no' : 'yes'
    const waitMs = config.everyMs - (deps.now() - startedAt)
    if (waitMs > 0 && !shouldStop()) await deps.sleep(waitMs)
  }
  return summarizeProbe(tally)
}

/**
 * Every phase sends all five settings, in this order, so no phase inherits the previous one's.
 * Seeded phases first wait for live: the transport drops dev commands while disconnected, so a
 * reset sent then would silently leave the previous market running. Resolves whether the seed was applied.
 */
export async function applySettings(
  p: Pick<BenchPhase, 'tradesPerSec' | 'batchMs' | 'latencyMs' | 'dropRate' | 'aggregation' | 'seed' | 'probe'>,
  deps: SettingsDeps,
): Promise<boolean> {
  const { target } = deps
  const live = p.seed !== 'live' && (await waitForLive(deps))
  target.sendDev({ kind: 'set_rate', tradesPerSec: p.tradesPerSec })
  target.sendDev({ kind: 'set_batch_interval', ms: p.batchMs })
  target.sendDev({ kind: 'set_latency', ms: p.latencyMs })
  target.sendDev({ kind: 'set_drop_rate', rate: p.dropRate })
  target.sendDev({ kind: 'set_aggregation', mode: p.aggregation })
  // After set_rate: a rate change redraws the pending arrival gap, which would make the replay
  // depend on when the command landed. Before set_balance: the reset rebuilds the account.
  if (p.seed !== 'live' && live) target.sendDev({ kind: 'reset_market', seed: p.seed })
  // Probe orders spend cash; start every probe phase from the same balance.
  if (p.probe !== 'off') target.sendDev({ kind: 'set_balance', usd: PROBE_START_BALANCE_USD })
  return live
}

/** Runs the scenario; the server's settings are restored to defaults however it ends (done, cancelled or thrown). */
export async function runBench(scenario: BenchScenario, deps: BenchDeps): Promise<BenchPhaseResult[] | 'cancelled'> {
  try {
    return await runPhases(scenario, deps)
  } finally {
    restoreDefaults(deps.target)
  }
}

/** Puts the server back at the default rate/batch/latency/drop/aggregation. */
export function restoreDefaults(target: Pick<BenchTarget, 'sendDev'>): void {
  target.sendDev({ kind: 'set_rate', tradesPerSec: DEFAULT_TRADES_PER_SEC })
  target.sendDev({ kind: 'set_batch_interval', ms: BATCH_INTERVAL_MS })
  target.sendDev({ kind: 'set_latency', ms: 0 })
  target.sendDev({ kind: 'set_drop_rate', rate: 0 })
  target.sendDev({ kind: 'set_aggregation', mode: DEFAULT_AGGREGATION })
}

async function runPhases(scenario: BenchScenario, deps: BenchDeps): Promise<BenchPhaseResult[] | 'cancelled'> {
  const results: BenchPhaseResult[] = []
  for (const [index, p] of scenario.phases.entries()) {
    deps.onPhase(p, index)
    const seedApplied = await applySettings(p, deps)
    await deps.sleep(scenario.warmupMs)
    if (deps.isCancelled()) return 'cancelled'

    const result = await measurePhase(p, seedApplied, deps)
    if (result === 'cancelled') return 'cancelled'
    results.push(result)
  }
  return results
}

/** One measured window plus its settle (probe drain, wait for live). Status listener is always removed. */
async function measurePhase(p: BenchPhase, seedApplied: boolean, deps: BenchDeps): Promise<BenchPhaseResult | 'cancelled'> {
  const timeline: StatusSample[] = []
  const stopTimeline = deps.target.onStatus((status) => timeline.push({ at: deps.now(), status }))
  try {
    deps.metrics.clearSamples()
    timeline.push({ at: deps.now(), status: deps.target.status() })
    const startStats = { ...deps.target.stats() }
    const startTotals = deps.metrics.snapshot().totals
    const startedAt = deps.now()
    const wallClockStartMs = deps.wallNow()
    deps.onWindow(p, 'start')
    // Requested now, awaited after capture so the window timing is not shifted by the round trip.
    const serverStart = deps.target.serverStats()

    let measuring = true
    const probeStop = (): boolean => !measuring || deps.isCancelled()
    const probe: Promise<ProbeResult | 'off'> = p.probe === 'off' ? Promise.resolve('off') : runProbe(p.probe, deps, probeStop)

    // Disconnects are spaced by duration / (n + 1) so each one hits a live connection.
    const slice = p.durationMs / (p.disconnects + 1)
    for (let i = 0; i < p.disconnects; i++) {
      await deps.sleep(slice)
      if (deps.isCancelled()) return 'cancelled'
      deps.target.sendDev({ kind: 'force_disconnect' })
    }
    await deps.sleep(slice)
    if (deps.isCancelled()) return 'cancelled'

    // Capture before waiting for the probe or for live so rates cover exactly the measured window.
    const endedAt = deps.now()
    deps.onWindow(p, 'end')
    const serverEnd = deps.target.serverStats()
    const elapsedMs = endedAt - startedAt
    const endStats = { ...deps.target.stats() }
    const snap = deps.metrics.snapshot()
    const heapMb = deps.heapMb()
    measuring = false

    const pick = (stats: ClientStats) => ({
      messages: stats.messages,
      trades: stats.trades,
      tradeItems: stats.tradeItems,
      bytes: stats.bytes,
    })
    const received = ratesPerSecond(pick(endStats), pick(startStats), elapsedMs)
    const commits = ratesPerSecond(snap.totals.commits, startTotals.commits, elapsedMs)
    const commitsTotal = Object.values(commits).reduce((sum, rate) => sum + rate, 0)

    const serverTicks = serverTickWindow(await serverStart, await serverEnd, elapsedMs)
    const probeResult = await probe
    if (deps.isCancelled()) return 'cancelled'
    const endedLive = await waitForLive(deps)
    if (deps.isCancelled()) return 'cancelled'
    // Outages that started in the window and recovered while settling still count.
    const recovery = recoveryTimes(timeline, endedAt)
    // Dev commands are dropped while disconnected, so the reset goes out once live again.
    deps.target.sendDev({ kind: 'set_latency', ms: 0 })
    deps.target.sendDev({ kind: 'set_drop_rate', rate: 0 })

    const displayHz = snap.displayHz
    return {
      phase: p.name,
      group: p.group,
      tradesPerSec: p.tradesPerSec,
      batchMs: p.batchMs,
      latencyMs: p.latencyMs,
      dropRate: p.dropRate,
      aggregation: p.aggregation,
      seed: p.seed,
      seedApplied,
      durationSec: round2(elapsedMs / 1_000),
      windowStartMs: round2(startedAt),
      windowEndMs: round2(endedAt),
      wallClockStartMs,
      fps: snap.fps,
      frameP50Ms: round2(snap.frameP50),
      frameP95Ms: round2(snap.frameP95),
      frameP99Ms: round2(snap.frameP99),
      pctFramesOverBudget: round2(snap.pctFramesOverBudget),
      displayHz,
      flushP50Ms: round2(snap.flushP50),
      flushP95Ms: round2(snap.flushP95),
      flushMaxMs: round2(snap.flushMax),
      dataAgeP50Ms: round2(snap.dataAgeP50),
      dataAgeP95Ms: round2(snap.dataAgeP95),
      ticksPerFlushP50: snap.ticksPerFlushP50,
      receivedMessagesPerSec: round2(received.messages),
      receivedTradesPerSec: round2(received.trades),
      receivedItemsPerSec: round2(received.tradeItems),
      receivedKBPerSec: round2(received.bytes / BYTES_PER_KB),
      commitsPerSecTotal: round2(commitsTotal),
      commitsPerSec: Object.fromEntries(Object.entries(commits).map(([id, rate]) => [id, round2(rate)])),
      longTasks: snap.totals.longTasks - startTotals.longTasks,
      longTaskMaxMs: round2(snap.windowLongTaskMaxMs),
      ...loafWindow(snap, snap.totals.longAnimationFrames - startTotals.longAnimationFrames, elapsedMs),
      interactions: snap.interactions.count,
      inpP75Ms: optionalRound2(snap.interactions.p75Ms),
      inpMaxMs: optionalRound2(snap.interactions.maxMs),
      ...serverTicks,
      heapMb,
      gaps: endStats.gaps - startStats.gaps,
      resyncs: endStats.resyncs - startStats.resyncs,
      duplicates: endStats.duplicates - startStats.duplicates,
      reconnects: endStats.reconnects - startStats.reconnects,
      ...recoverySummary(recovery),
      endedLive,
      probeConfig: p.probe,
      probe: probeResult,
      environment: { ...deps.environment, displayHz, seed: p.seed },
    }
  } finally {
    stopTimeline()
  }
}
