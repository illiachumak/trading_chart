// Runs the scripted benchmark against the live runtime when the URL has `?bench=<mode>`:
// `realistic` and `soak` are the tracked set; `quick|matrix|deep|scale` reproduce the published v2 numbers.
// `&cpu=<label>` (e.g. `4x`) is stored in each result's environment as metadata only; nothing is throttled.
// Harness hooks: `<html data-bench-phase>` is the phase name only inside the measured window,
// `warmup:<name>` before it, `settle` after it and `done` at the end, so an external CDP sampler can
// align its samples; each result also carries window timestamps. The soak marks its single window the same way
// (`warmup:<name>`, `<name>`, `done`). Results go to the panel and `console.info('[bench]')`.

import { useEffect, useState } from 'react'
import { BENCH_AVAILABLE } from '@/config/bench'
import { BUILD_HASH } from '@/config/build'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import {
  type BenchPhaseResult,
  type BenchRunEnvironment,
  type BenchScenario,
  type BenchTarget,
  type ProbeQuote,
  type ServerTickStats,
  DEEP_SCENARIO,
  MATRIX_SCENARIO,
  SCALE_SCENARIO,
  QUICK_SCENARIO,
  REALISTIC_SCENARIO,
  readCpuThrottleLabel,
  readHeapMb,
  runBench,
  seedWarning,
} from '@/lib/perf/bench'
import { browserSamplingEnv, perfMetrics } from '@/lib/perf/perf-metrics'
import { type SoakResult, SOAK_CONFIG, runSoak } from '@/lib/perf/soak'
import type { MarketRuntime } from '@/lib/realtime/market-runtime'
import { selectRound } from '@/lib/realtime/market-store'
import type { OrderResult, ServerMessage } from '@/lib/realtime/protocol'

type ScenarioMode = 'quick' | 'matrix' | 'deep' | 'scale' | 'realistic'
export type BenchMode = ScenarioMode | 'soak'

/** Phase results of a scenario run, or the single soak result. */
export type BenchOutput = { kind: 'phases'; results: BenchPhaseResult[] } | { kind: 'soak'; result: SoakResult }

export type BenchState =
  | { kind: 'idle'; mode: BenchMode }
  | { kind: 'running'; mode: BenchMode; phase: string; index: number; total: number }
  /** `seedWarning` names phases that ran unseeded (their numbers are not reproducible), or 'none'. */
  | { kind: 'done'; mode: BenchMode; output: BenchOutput; seedWarning: string | 'none' }

const QUOTE_TIMEOUT_MS = 2_000
const ORDER_TIMEOUT_MS = 3_000
const SERVER_STATS_TIMEOUT_MS = 1_000
const LIVE_POLL_MS = 100

const BENCH_MODES: readonly BenchMode[] = ['quick', 'matrix', 'deep', 'scale', 'realistic', 'soak']

function readMode(): BenchMode | 'disabled' {
  if (!BENCH_AVAILABLE) return 'disabled'
  const value = new URLSearchParams(window.location.search).get('bench')
  return BENCH_MODES.find((mode) => mode === value) ?? 'disabled'
}

const SCENARIOS: Record<ScenarioMode, BenchScenario> = {
  quick: QUICK_SCENARIO,
  matrix: MATRIX_SCENARIO,
  deep: DEEP_SCENARIO,
  scale: SCALE_SCENARIO,
  realistic: REALISTIC_SCENARIO,
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function setHarnessPhase(phase: string | 'clear'): void {
  if (phase === 'clear') delete document.documentElement.dataset.benchPhase
  else document.documentElement.dataset.benchPhase = phase
}

/** Probe quotes use their own requestId range so AccountStore (the trade ticket) ignores their answers. */
const PROBE_ID_BASE = 1_000_000_000

/** Resolves with the first server message `pick` maps to a value, or 'timeout'; always unsubscribes. */
function waitForMessage<T>(runtime: MarketRuntime, pick: (message: ServerMessage) => T | 'no', timeoutMs: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const finish = (value: T | 'timeout'): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    const unsubscribe = runtime.client.onMessage((message) => {
      const value = pick(message)
      if (value !== 'no') finish(value)
    })
  })
}

/**
 * Talks to the backend directly through the client, bypassing AccountStore: the probe's quotes and
 * orders never touch the trade ticket's state, and the ticket's own quote refreshes can't supersede them.
 */
function createBenchTarget(runtime: MarketRuntime): BenchTarget {
  let probeRequests = 0
  return {
    sendDev: (command) => runtime.send({ type: 'dev', command }),
    stats: () => runtime.client.stats,
    status: () => runtime.client.getStatus(),
    onStatus: (listener) => runtime.client.onStatus(listener),
    serverStats: () => {
      const answer = waitForMessage(
        runtime,
        (m): ServerTickStats | 'no' =>
          m.type === 'server_stats' ? { tickCount: m.tickCount, tickMsTotal: m.tickMsTotal, tickMsMax: m.tickMsMax } : 'no',
        SERVER_STATS_TIMEOUT_MS,
      )
      runtime.send({ type: 'dev', command: { kind: 'report_server_stats' } })
      return answer
    },
    roundId: () => {
      const round = selectRound(runtime.market.store.getState())
      return round === 'loading' ? 'none' : round.id
    },
    quote: (side, amountUsd, maxSlippage) => {
      // The round is captured with the request so a later round change is detectable.
      const round = selectRound(runtime.market.store.getState())
      if (round === 'loading') return Promise.resolve('no_round')
      const requestId = PROBE_ID_BASE + probeRequests++
      const answer = waitForMessage(
        runtime,
        (m): ProbeQuote | 'no' =>
          m.type === 'quote_result' && m.quote.requestId === requestId ? { quote: m.quote, roundId: round.id } : 'no',
        QUOTE_TIMEOUT_MS,
      )
      runtime.send({ type: 'quote', requestId, side, amountUsd, maxSlippage })
      return answer
    },
    placeOrder: (request) => {
      const clientOrderId = crypto.randomUUID()
      const result = waitForMessage(
        runtime,
        (m): OrderResult | 'no' =>
          m.type === 'order_result' && m.result.clientOrderId === clientOrderId ? m.result : 'no',
        ORDER_TIMEOUT_MS,
      )
      runtime.send({ type: 'place_order', clientOrderId, ...request })
      return result
    },
  }
}

function readEnvironment(): BenchRunEnvironment {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    buildHash: BUILD_HASH,
    cpuThrottleLabel: readCpuThrottleLabel(window.location.search),
  }
}

/** Runs the benchmark once the session is live; 'disabled' without `?bench=`. */
export function useBench(): BenchState | 'disabled' {
  const runtime = useMarketRuntime()
  const [mode] = useState(readMode)
  const [state, setState] = useState<BenchState | 'disabled'>(() => (mode === 'disabled' ? 'disabled' : { kind: 'idle', mode }))

  useEffect(() => {
    if (mode === 'disabled') return
    let cancelled = false
    const release = perfMetrics.acquireSampling(browserSamplingEnv())
    const target = createBenchTarget(runtime)
    const common = {
      environment: readEnvironment(),
      metrics: perfMetrics,
      sleep,
      now: () => performance.now(),
      wallNow: () => Date.now(),
      heapMb: () => readHeapMb(performance),
      isCancelled: () => cancelled,
    }

    const runScenario = async (scenarioMode: ScenarioMode): Promise<BenchOutput | 'cancelled'> => {
      const scenario = SCENARIOS[scenarioMode]
      const results = await runBench(scenario, {
        ...common,
        target,
        onPhase: (phase, index) => {
          setHarnessPhase(`warmup:${phase.name}`)
          setState({ kind: 'running', mode, phase: phase.name, index, total: scenario.phases.length })
        },
        // The bare phase name marks only the measured window; 'settle' covers probe drain + wait for live.
        onWindow: (phase, edge) => setHarnessPhase(edge === 'start' ? phase.name : 'settle'),
      })
      return results === 'cancelled' ? results : { kind: 'phases', results }
    }

    const runSoakMode = async (): Promise<BenchOutput | 'cancelled'> => {
      const total = Math.ceil(SOAK_CONFIG.durationMs / SOAK_CONFIG.sampleEveryMs)
      setHarnessPhase(`warmup:${SOAK_CONFIG.name}`)
      setState({ kind: 'running', mode, phase: `${SOAK_CONFIG.name} · warm-up`, index: 0, total })
      const result = await runSoak(SOAK_CONFIG, {
        ...common,
        target,
        onWindow: (edge) => setHarnessPhase(edge === 'start' ? SOAK_CONFIG.name : 'settle'),
        // One state update per sample (once a minute by default).
        onSample: (sample, count) =>
          setState({ kind: 'running', mode, phase: `${SOAK_CONFIG.name} · sample ${sample.index}`, index: sample.index - 1, total: count }),
      })
      return result === 'cancelled' ? result : { kind: 'soak', result }
    }

    const run = async (): Promise<void> => {
      while (runtime.client.getStatus() !== 'live') {
        await sleep(LIVE_POLL_MS)
        if (cancelled) return
      }
      const output = mode === 'soak' ? await runSoakMode() : await runScenario(mode)
      if (output === 'cancelled' || cancelled) return
      setHarnessPhase('done')
      console.info('[bench]', JSON.stringify(output.kind === 'phases' ? output.results : output.result))
      const warning = seedWarning(
        output.kind === 'phases' ? output.results : [{ phase: output.result.name, seedApplied: output.result.seedApplied }],
      )
      if (warning !== 'none') console.warn('[bench]', warning)
      setState({ kind: 'done', mode, output, seedWarning: warning })
    }
    void run()

    return () => {
      cancelled = true
      release()
      setHarnessPhase('clear')
    }
  }, [mode, runtime])

  return state
}
