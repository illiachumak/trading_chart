import { DevPanel } from '@/components/features/dev-tools/dev-panel'
import { PriceChart } from '@/components/features/chart/price-chart'
import { RoundHistory } from '@/components/features/round/round-history'
import { RoundHeader } from '@/components/features/round/round-header'
import { TradesFeed } from '@/components/features/trades-feed/trades-feed'
import { TradePanel } from '@/components/features/trade-panel/trade-panel'
import { ErrorBoundary } from '@/components/common/error-boundary'
import { FeatureBoundary } from '@/components/common/feature-boundary'
import { Container } from '@/components/layout/container'
import { Header } from '@/components/layout/header'

export function AppShell() {
  return (
    <div className="flex min-h-full flex-col">
      <FeatureBoundary id="header">
        <Header />
      </FeatureBoundary>
      <Container
        as="main"
        className="grid flex-1 grid-cols-1 gap-4 py-4 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]"
      >
        <section className="card flex min-w-0 flex-col gap-4 p-4 md:p-5 lg:col-start-1 lg:row-start-1">
          <FeatureBoundary id="round-header">
            <RoundHeader />
          </FeatureBoundary>
          <div className="dot-grid overflow-hidden rounded-control">
            <FeatureBoundary id="chart">
              <PriceChart />
            </FeatureBoundary>
          </div>
        </section>
        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TradePanel />
        </aside>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:col-start-1 lg:row-start-2">
          <FeatureBoundary id="trades-feed">
            <TradesFeed />
          </FeatureBoundary>
          <FeatureBoundary id="round-history">
            <RoundHistory />
          </FeatureBoundary>
        </div>
      </Container>
      <ErrorBoundary name="dev-tools">
        <DevPanel />
      </ErrorBoundary>
    </div>
  )
}
