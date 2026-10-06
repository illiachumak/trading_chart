// Runs the scripted benchmark against the live runtime when the URL has `?bench=quick|matrix|deep`.
// Harness hooks: `<html data-bench-phase>` is the phase name only inside the measured window,
// `warmup:<name>` before it, `settle` after it and `done` at the end, so an external CDP sampler can
// align its samples; each result also carries window timestamps. Results go to the panel and `console.info('[bench]')`.

import { useEffect, useState } from 'react'
import { BENCH_AVAILABLE } from '@/config/bench'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import {
  type BenchPhaseResult,
  type BenchScenario,
  type BenchTarget,
  type ProbeQuote,
  DEEP_SCENARIO,
  MATRIX_SCENARIO,
  QUICK_SCENARIO,
  readHeapMb,
  runBench,
} from '@/lib/perf/bench'
import { browserSamplingEnv, perfMetrics } from '@/lib/perf/perf-metrics'
import type { MarketRuntime } from '@/lib/realtime/market-runtime'
import { selectRound } from '@/lib/realtime/market-store'
import type { OrderResult, ServerMessage } from '@/lib/realtime/protocol'

export type BenchMode = 'quick' | 'matrix' | 'deep'

export type BenchState =
  | { kind: 'idle'; mode: BenchMode }
  | { kind: 'running'; mode: BenchMode; phase: string; index: number; total: number }
  | { kind: 'done'; mode: BenchMode; results: BenchPhaseResult[] }

const QUOTE_TIMEOUT_MS = 2_000
const ORDER_TIMEOUT_MS = 3_000
const LIVE_POLL_MS = 100

function readMode(): BenchMode | 'disabled' {
  if (!BENCH_AVAILABLE) return 'disabled'
  const value = new URLSearchParams(window.location.search).get('bench')
  return value === 'quick' || value === 'matrix' || value === 'deep' ? value : 'disabled'
}

const SCENARIOS: Record<BenchMode, BenchScenario> = { quick: QUICK_SCENARIO, matrix: MATRIX_SCENARIO, deep: DEEP_SCENARIO }

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
    roundId: () => {
      const round = selectRound(runtime.market.store.getState())
      return round === 'loading' ? 'none' : round.id
    },
    quote: (side, amountUsd) => {
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
      runtime.send({ type: 'quote', requestId, side, amountUsd })
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

/** Runs the benchmark once the session is live; 'disabled' without `?bench=`. */
export function useBench(): BenchState | 'disabled' {
  const runtime = useMarketRuntime()
  const [mode] = useState(readMode)
  const [state, setState] = useState<BenchState | 'disabled'>(() => (mode === 'disabled' ? 'disabled' : { kind: 'idle', mode }))

  useEffect(() => {
    if (mode === 'disabled') return
    let cancelled = false
    const release = perfMetrics.acquireSampling(browserSamplingEnv())
    const scenario = SCENARIOS[mode]

    const run = async (): Promise<void> => {
      while (runtime.client.getStatus() !== 'live') {
        await sleep(LIVE_POLL_MS)
        if (cancelled) return
      }
      const results = await runBench(scenario, {
        target: createBenchTarget(runtime),
        metrics: perfMetrics,
        sleep,
        now: () => performance.now(),
        wallNow: () => Date.now(),
        heapMb: () => readHeapMb(performance),
        isCancelled: () => cancelled,
        onPhase: (phase, index) => {
          setHarnessPhase(`warmup:${phase.name}`)
          setState({ kind: 'running', mode, phase: phase.name, index, total: scenario.phases.length })
        },
        // The bare phase name marks only the measured window; 'settle' covers probe drain + wait for live.
        onWindow: (phase, edge) => setHarnessPhase(edge === 'start' ? phase.name : 'settle'),
      })
      if (results === 'cancelled' || cancelled) return
      setHarnessPhase('done')
      console.info('[bench]', JSON.stringify(results))
      setState({ kind: 'done', mode, results })
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
