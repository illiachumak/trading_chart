// Runs the scripted benchmark against the live runtime when the URL has `?bench=quick|matrix`.
// Harness hooks: `<html data-bench-phase>` names the running phase ('done' at the end) so an
// external CDP sampler can align its samples; results go to the panel and `console.info('[bench]')`.

import { useEffect, useState } from 'react'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import {
  type BenchPhaseResult,
  type BenchTarget,
  MATRIX_SCENARIO,
  QUICK_SCENARIO,
  readHeapMb,
  runBench,
} from '@/lib/perf/bench'
import { browserSamplingEnv, perfMetrics } from '@/lib/perf/perf-metrics'
import type { AccountStoreState } from '@/lib/realtime/account-store'
import type { MarketRuntime } from '@/lib/realtime/market-runtime'
import { selectRound } from '@/lib/realtime/market-store'
import type { OrderResult, QuoteResult } from '@/lib/realtime/protocol'
import type { ExternalStore } from '@/lib/utils/external-store'

export type BenchMode = 'quick' | 'matrix'

export type BenchState =
  | { kind: 'idle'; mode: BenchMode }
  | { kind: 'running'; mode: BenchMode; phase: string; index: number; total: number }
  | { kind: 'done'; mode: BenchMode; results: BenchPhaseResult[] }

const QUOTE_TIMEOUT_MS = 2_000
const ORDER_TIMEOUT_MS = 3_000
const LIVE_POLL_MS = 100

function readMode(): BenchMode | 'disabled' {
  const value = new URLSearchParams(window.location.search).get('bench')
  return value === 'quick' || value === 'matrix' ? value : 'disabled'
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function setHarnessPhase(phase: string | 'clear'): void {
  if (phase === 'clear') delete document.documentElement.dataset.benchPhase
  else document.documentElement.dataset.benchPhase = phase
}

/** Resolves with the first store state `pick` maps to a value, or 'timeout'. */
function waitForState<S, T>(store: ExternalStore<S>, pick: (state: S) => T | 'no', timeoutMs: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const finish = (value: T | 'timeout'): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    const unsubscribe = store.subscribe(() => {
      const value = pick(store.getState())
      if (value !== 'no') finish(value)
    })
  })
}

function createBenchTarget(runtime: MarketRuntime): BenchTarget {
  const account = runtime.account
  return {
    sendDev: (command) => runtime.send({ type: 'dev', command }),
    stats: () => runtime.client.stats,
    status: () => runtime.client.getStatus(),
    quote: (side, amountUsd) => {
      const previous = account.store.getState().quote
      const answer = waitForState(
        account.store,
        (s: AccountStoreState): QuoteResult | 'no' =>
          s.quote !== 'none' && s.quote !== previous && s.quote.side === side && s.quote.amountUsd === amountUsd
            ? s.quote
            : 'no',
        QUOTE_TIMEOUT_MS,
      )
      account.requestQuote(side, amountUsd)
      return answer
    },
    placeOrder: async (request) => {
      const round = selectRound(runtime.market.store.getState())
      // No round yet means nothing can be traded; report it like a refused order.
      if (round === 'loading') return 'busy'
      const clientOrderId = crypto.randomUUID()
      const result = waitForState(
        account.store,
        (s: AccountStoreState): OrderResult | 'no' =>
          s.order.kind === 'done' && s.order.result.clientOrderId === clientOrderId ? s.order.result : 'no',
        ORDER_TIMEOUT_MS,
      )
      if (account.placeOrder({ clientOrderId, roundId: round.id, ...request }) === 'busy') return 'busy'
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
    const scenario = mode === 'matrix' ? MATRIX_SCENARIO : QUICK_SCENARIO

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
        heapMb: () => readHeapMb(performance),
        isCancelled: () => cancelled,
        onPhase: (phase, index) => {
          setHarnessPhase(phase.name)
          setState({ kind: 'running', mode, phase: phase.name, index, total: scenario.phases.length })
        },
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
