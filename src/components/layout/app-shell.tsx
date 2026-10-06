import { PriceChart } from '@/components/features/chart/price-chart'
import { RoundHeader } from '@/components/features/round/round-header'
import { FeatureBoundary } from '@/components/common/feature-boundary'
import { Header } from '@/components/layout/header'

export function AppShell() {
  return (
    <div className="flex min-h-full flex-col">
      <FeatureBoundary id="header">
        <Header />
      </FeatureBoundary>
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 px-4 py-4 md:px-8 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="card flex flex-col gap-4 p-4 md:p-5">
            <FeatureBoundary id="round-header">
              <RoundHeader />
            </FeatureBoundary>
            <div className="dot-grid overflow-hidden rounded-control">
              <FeatureBoundary id="chart">
                <PriceChart />
              </FeatureBoundary>
            </div>
          </section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{/* Task 5: TradesFeed + RoundHistory */}</div>
        </div>
        <aside className="flex flex-col gap-4">{/* Task 4: TradePanel */}</aside>
      </main>
      {/* Task 6: DevPanel */}
    </div>
  )
}
