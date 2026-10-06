import { MarketRuntimeProvider } from '@/components/features/market/market-runtime-provider'
import { AppShell } from '@/components/layout/app-shell'

export function App() {
  return (
    <MarketRuntimeProvider>
      <AppShell />
    </MarketRuntimeProvider>
  )
}
