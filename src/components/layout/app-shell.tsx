import { FeatureBoundary } from '@/components/common/feature-boundary'
import { Header } from '@/components/layout/header'

export function AppShell() {
  return (
    <div className="flex min-h-full flex-col">
      <FeatureBoundary id="header">
        <Header />
      </FeatureBoundary>
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            {/* Task 3: RoundHeader + PriceChart */}
          </section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{/* Task 5: TradesFeed + RoundHistory */}</div>
        </div>
        <aside className="flex flex-col gap-4">{/* Task 4: TradePanel */}</aside>
      </main>
      {/* Task 6: DevPanel */}
    </div>
  )
}
