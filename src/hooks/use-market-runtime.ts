import { useContext } from 'react'
import type { MarketRuntime } from '@/lib/realtime/market-runtime'
import { MarketRuntimeContext } from '@/lib/realtime/market-runtime-context'

export function useMarketRuntime(): MarketRuntime {
  const runtime = useContext(MarketRuntimeContext)
  if (runtime === 'none') throw new Error('useMarketRuntime must be used inside <MarketRuntimeProvider>')
  return runtime
}
