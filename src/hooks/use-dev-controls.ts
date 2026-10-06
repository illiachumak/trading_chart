import { useCallback, useState } from 'react'
import { DEFAULT_TRADES_PER_SEC, STRESS_TRADES_PER_SEC } from '@/config/market'
import { useMarketRuntime } from '@/hooks/use-market-runtime'
import type { DevCommand } from '@/lib/realtime/protocol'

export type DevControls = {
  rate: number
  latencyMs: number
  dropRatePct: number
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

  const send = useCallback((command: DevCommand) => runtime.send({ type: 'dev', command }), [runtime])

  return {
    rate,
    latencyMs,
    dropRatePct,
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
