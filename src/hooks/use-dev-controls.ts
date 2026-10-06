import { useCallback, useState } from 'react'
import { BATCH_INTERVAL_MS, DEFAULT_AGGREGATION, DEFAULT_TRADES_PER_SEC, STRESS_TRADES_PER_SEC } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import type { AggregationMode, DevCommand } from '@/lib/realtime/protocol'

export type DevControls = {
  rate: number
  latencyMs: number
  dropRatePct: number
  batchIntervalMs: number
  aggregation: AggregationMode
  setBatchIntervalMs: (value: number) => void
  setAggregation: (mode: AggregationMode) => void
  setRate: (value: number) => void
  setLatency: (value: number) => void
  setDropRatePct: (value: number) => void
  stress: () => void
  dropConnection: () => void
}

export function useDevControls(): DevControls {
  const runtime = useMarketRuntime()
  const [rate, setRateState] = useState(DEFAULT_TRADES_PER_SEC)
  const [latencyMs, setLatencyState] = useState(0)
  const [dropRatePct, setDropState] = useState(0)
  const [batchIntervalMs, setBatchState] = useState<number>(BATCH_INTERVAL_MS)
  const [aggregation, setAggregationState] = useState<AggregationMode>(DEFAULT_AGGREGATION)

  const send = useCallback((command: DevCommand) => runtime.send({ type: 'dev', command }), [runtime])

  return {
    rate,
    latencyMs,
    dropRatePct,
    batchIntervalMs,
    aggregation,
    setBatchIntervalMs: (value: number) => {
      setBatchState(value)
      send({ kind: 'set_batch_interval', ms: value })
    },
    setAggregation: (mode: AggregationMode) => {
      setAggregationState(mode)
      send({ kind: 'set_aggregation', mode })
    },
    setRate: (value: number) => {
      setRateState(value)
      send({ kind: 'set_rate', tradesPerSec: value })
    },
    setLatency: (value: number) => {
      setLatencyState(value)
      send({ kind: 'set_latency', ms: value })
    },
    setDropRatePct: (value: number) => {
      setDropState(value)
      send({ kind: 'set_drop_rate', rate: value / 100 })
    },
    stress: () => {
      setRateState(STRESS_TRADES_PER_SEC)
      send({ kind: 'set_rate', tradesPerSec: STRESS_TRADES_PER_SEC })
    },
    dropConnection: () => send({ kind: 'force_disconnect' }),
  }
}
