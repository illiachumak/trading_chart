import { ErrorBoundary } from '@/components/common/error-boundary'
import { MarketRuntimeProvider } from '@/components/features/market/market-runtime-provider'
import { AppShell } from '@/components/layout/app-shell'

export function App() {
  return (
    <ErrorBoundary name="app">
      <MarketRuntimeProvider>
        <AppShell />
      </MarketRuntimeProvider>
    </ErrorBoundary>
  )
}
