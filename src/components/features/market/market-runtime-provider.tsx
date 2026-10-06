import { type ReactNode, useEffect, useState } from 'react'
import { createBrowserWorker, MarketRuntime } from '@/lib/realtime/market-runtime'
import { MarketRuntimeContext } from '@/lib/realtime/market-runtime-context'

export function MarketRuntimeProvider({ children }: { children: ReactNode }) {
  // The worker is created lazily in start(), so StrictMode's double initializer is harmless.
  const [runtime] = useState(() => new MarketRuntime(createBrowserWorker))

  useEffect(() => {
    runtime.start()
    return () => runtime.stop()
  }, [runtime])

  return <MarketRuntimeContext value={runtime}>{children}</MarketRuntimeContext>
}
