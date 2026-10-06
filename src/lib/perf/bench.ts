// Scripted benchmark: drives the mock backend through a parameter matrix (trade rate ×
// batch interval × slippage × faults), optionally probes order fills, and samples the
// same collectors the HUD uses. Pure — the browser wiring is in useBench.

import { BATCH_INTERVAL_MS, DEFAULT_TRADES_PER_SEC } from '@/config/market'
import type { PerfMetrics } from '@/lib/perf/perf-metrics'
import { ratesPerSecond } from '@/lib/perf/rates'
import type { ClientStats, ConnectionStatus } from '@/lib/realtime/market-client'
import type { DevCommand, OrderResult, QuoteResult, RejectReason, Side } from '@/lib/realtime/protocol'
import { isRecord } from '@/lib/utils/is-record'

export type ProbeConfig = { slippage: number; amountUsd: number; everyMs: number; quoteAgeMs: number }

export type BenchGroup = 'load' | 'batch' | 'slippage' | 'faults'

export type BenchPhase = {
  name: string
  group: BenchGroup
  tradesPerSec: number
  batchMs: number
  durationMs: number
  disconnects: number
  latencyMs: number
  dropRate: number
  probe: ProbeConfig | 'off'
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
  /** Probe ticks that placed no order: quote timed out / unavailable, or no round yet. */
  skipped: number
  /** Fill-rate denominator: filled + slippage rejects (the only outcomes the tolerance decides). */
  n: number
  /** filled / n; 0 when n is 0. round_closed, timeouts etc. are reported separately, not counted here. */
  fillRate: number
  /** (fill avg − quoted avg) × 100, over filled orders; zeros when nothing filled. */
  realizedSlippageCents: { p50: number; p95: number; max: number }
}

export type OrderProbeRequest = { side: Side; amountUsd: number; expectedPrice: number; maxSlippage: number }

export type BenchTarget = {
  sendDev(command: DevCommand): void
  stats(): ClientStats
  status(): ConnectionStatus
  /** Fresh quote for (side, amount); resolves 'timeout' after 2 s. */
  quote(side: Side, amountUsd: number): Promise<QuoteResult | 'timeout'>
  /** Places an order and resolves with its result; 'timeout' after 3 s, 'no_round' before the first round. */
  placeOrder(request: OrderProbeRequest): Promise<OrderResult | 'timeout' | 'no_round'>
}

export type BenchDeps = {
  target: BenchTarget
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
  durationSec: number
  /** Measured window in `now()` time (performance.now in the browser). */
  windowStartMs: number
  windowEndMs: number
  /** Date.now() at window start. */
  wallClockStartMs: number
  fps: number
  frameP95Ms: number
  flushP50Ms: number
  flushP95Ms: number
  flushMaxMs: number
  latencyP50Ms: number
  latencyP95Ms: number
  ticksPerFlushP50: number
  receivedMessagesPerSec: number
  receivedTradesPerSec: number
  commitsPerSecTotal: number
  commitsPerSec: Record<string, number>
  longTasks: number
  /** Longest long task inside the measured window. */
  longTaskMaxMs: number
  heapMb: number | 'n/a'
  gaps: number
  resyncs: number
  duplicates: number
  reconnects: number
  endedLive: boolean
  probeConfig: ProbeConfig | 'off'
  probe: ProbeResult | 'off'
}

// --- Scenarios (see the "Experiment design" table in the PR 4 v2 plan) ---

const MATRIX_PHASE_MS = 12_000
const QUICK_PHASE_MS = 4_000
const PROBE_AMOUNT_USD = 5
const PROBE_EVERY_MS = 1_000

const phase = (fields: Partial<BenchPhase> & Pick<BenchPhase, 'name' | 'group' | 'tradesPerSec'>): BenchPhase => ({
  batchMs: BATCH_INTERVAL_MS,
  durationMs: MATRIX_PHASE_MS,
  disconnects: 0,
  latencyMs: 0,
  dropRate: 0,
  probe: 'off',
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

// --- Helpers ---

const LIVE_POLL_MS = 100
const LIVE_TIMEOUT_MS = 5_000
const BYTES_PER_MB = 1_048_576

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Nearest-rank percentile of an ascending array; 0 when empty. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

/** Chrome-only `performance.memory.usedJSHeapSize`, in MB. */
export function readHeapMb(perf: unknown): number | 'n/a' {
  if (!isRecord(perf) || !isRecord(perf.memory)) return 'n/a'
  const used = perf.memory.usedJSHeapSize
  return typeof used === 'number' && Number.isFinite(used) ? round2(used / BYTES_PER_MB) : 'n/a'
}

async function waitForLive(deps: BenchDeps): Promise<boolean> {
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
      p50: round2(percentile(sorted, 0.5)),
      p95: round2(percentile(sorted, 0.95)),
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
    const quote = await deps.target.quote(side, config.amountUsd)
    if (quote === 'timeout' || quote.status !== 'ok') {
      tally.skipped++
    } else {
      if (config.quoteAgeMs > 0) await deps.sleep(config.quoteAgeMs)
      if (shouldStop()) break
      const result = await deps.target.placeOrder({
        side,
        amountUsd: config.amountUsd,
        expectedPrice: quote.avgPrice,
        maxSlippage: config.slippage,
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

/** Every phase sends all four settings, in this order, so no phase inherits the previous one's. */
function applySettings(p: BenchPhase, target: BenchTarget): void {
  target.sendDev({ kind: 'set_rate', tradesPerSec: p.tradesPerSec })
  target.sendDev({ kind: 'set_batch_interval', ms: p.batchMs })
  target.sendDev({ kind: 'set_latency', ms: p.latencyMs })
  target.sendDev({ kind: 'set_drop_rate', rate: p.dropRate })
}

export async function runBench(scenario: BenchScenario, deps: BenchDeps): Promise<BenchPhaseResult[] | 'cancelled'> {
  const results: BenchPhaseResult[] = []
  for (const [index, p] of scenario.phases.entries()) {
    deps.onPhase(p, index)
    applySettings(p, deps.target)
    await deps.sleep(scenario.warmupMs)
    if (deps.isCancelled()) return 'cancelled'

    deps.metrics.clearSamples()
    const startStats = { ...deps.target.stats() }
    const startTotals = deps.metrics.snapshot().totals
    const startedAt = deps.now()
    const wallClockStartMs = deps.wallNow()
    deps.onWindow(p, 'start')

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
    const elapsedMs = endedAt - startedAt
    const endStats = { ...deps.target.stats() }
    const snap = deps.metrics.snapshot()
    const heapMb = deps.heapMb()
    measuring = false

    const received = ratesPerSecond(
      { messages: endStats.messages, trades: endStats.trades },
      { messages: startStats.messages, trades: startStats.trades },
      elapsedMs,
    )
    const commits = ratesPerSecond(snap.totals.commits, startTotals.commits, elapsedMs)
    const commitsTotal = Object.values(commits).reduce((sum, rate) => sum + rate, 0)

    const probeResult = await probe
    if (deps.isCancelled()) return 'cancelled'
    const endedLive = await waitForLive(deps)
    if (deps.isCancelled()) return 'cancelled'
    // Dev commands are dropped while disconnected, so the reset goes out once live again.
    deps.target.sendDev({ kind: 'set_latency', ms: 0 })
    deps.target.sendDev({ kind: 'set_drop_rate', rate: 0 })

    results.push({
      phase: p.name,
      group: p.group,
      tradesPerSec: p.tradesPerSec,
      batchMs: p.batchMs,
      latencyMs: p.latencyMs,
      dropRate: p.dropRate,
      durationSec: round2(elapsedMs / 1_000),
      windowStartMs: round2(startedAt),
      windowEndMs: round2(endedAt),
      wallClockStartMs,
      fps: snap.fps,
      frameP95Ms: round2(snap.frameP95),
      flushP50Ms: round2(snap.flushP50),
      flushP95Ms: round2(snap.flushP95),
      flushMaxMs: round2(snap.flushMax),
      latencyP50Ms: round2(snap.latencyP50),
      latencyP95Ms: round2(snap.latencyP95),
      ticksPerFlushP50: snap.ticksPerFlushP50,
      receivedMessagesPerSec: round2(received.messages),
      receivedTradesPerSec: round2(received.trades),
      commitsPerSecTotal: round2(commitsTotal),
      commitsPerSec: Object.fromEntries(Object.entries(commits).map(([id, rate]) => [id, round2(rate)])),
      longTasks: snap.totals.longTasks - startTotals.longTasks,
      longTaskMaxMs: round2(snap.windowLongTaskMaxMs),
      heapMb,
      gaps: endStats.gaps - startStats.gaps,
      resyncs: endStats.resyncs - startStats.resyncs,
      duplicates: endStats.duplicates - startStats.duplicates,
      reconnects: endStats.reconnects - startStats.reconnects,
      endedLive,
      probeConfig: p.probe,
      probe: probeResult,
    })
  }
  deps.target.sendDev({ kind: 'set_rate', tradesPerSec: DEFAULT_TRADES_PER_SEC })
  deps.target.sendDev({ kind: 'set_batch_interval', ms: BATCH_INTERVAL_MS })
  return results
}
